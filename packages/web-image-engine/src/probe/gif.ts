import {
  HeaderProbeError,
  MAX_CONTAINER_BOXES,
  ascii,
  invalidContainer,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

function requireGifBytes(
  bytes: Uint8Array,
  sourceByteLength: number,
  start: number,
  length: number,
  context: string,
): void {
  try {
    requireBytes(bytes, start, length, context);
  } catch (error) {
    if (error instanceof HeaderProbeError && bytes.byteLength === sourceByteLength) {
      invalidContainer(`GIF is truncated while reading ${context}.`);
    }
    throw error;
  }
}

function skipSubBlocks(
  bytes: Uint8Array,
  sourceByteLength: number,
  start: number,
  blockBudget: { value: number },
): number {
  let offset = start;
  while (true) {
    blockBudget.value += 1;
    if (blockBudget.value > MAX_CONTAINER_BOXES) {
      invalidContainer("GIF contains too many data sub-blocks.");
    }
    requireGifBytes(bytes, sourceByteLength, offset, 1, "a data sub-block length");
    const length = bytes[offset] ?? 0;
    offset += 1;
    if (length === 0) return offset;
    requireGifBytes(bytes, sourceByteLength, offset, length, "a data sub-block");
    offset += length;
  }
}

export function parseGifHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  requireGifBytes(bytes, sourceByteLength, 0, 13, "the logical screen descriptor");
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    invalidContainer("GIF signature is invalid.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  if (width === 0 || height === 0) invalidContainer("GIF dimensions must be non-zero.");

  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    const colorTableBytes = 3 * 2 ** ((packed & 0x07) + 1);
    requireGifBytes(bytes, sourceByteLength, offset, colorTableBytes, "the global color table");
    offset += colorTableBytes;
  }

  let alpha: ParsedRasterHeader["alpha"] = "absent";
  let pendingTransparency = false;
  let frameCount = 0;
  let colorProfile: ParsedRasterHeader["colorProfile"] = "none";
  let xmp: ParsedRasterHeader["metadata"]["xmp"] = "absent";
  const blockBudget = { value: 0 };

  while (true) {
    blockBudget.value += 1;
    if (blockBudget.value > MAX_CONTAINER_BOXES) invalidContainer("GIF contains too many blocks.");
    requireGifBytes(bytes, sourceByteLength, offset, 1, "a block marker");
    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (marker === 0x3b) {
      if (frameCount === 0) invalidContainer("GIF contains no image frame.");
      if (offset !== sourceByteLength) invalidContainer("GIF has data after its trailer.");
      return {
        alpha,
        animation: frameCount > 1 ? "animated" : "static",
        colorProfile,
        format: "gif",
        height,
        metadata: { exif: "absent", iptc: "absent", orientation: null, xmp },
        width,
      };
    }

    if (marker === 0x21) {
      requireGifBytes(bytes, sourceByteLength, offset, 1, "an extension label");
      const label = bytes[offset] ?? 0;
      offset += 1;
      if (label === 0xf9) {
        requireGifBytes(bytes, sourceByteLength, offset, 6, "a graphic control extension");
        if (
          bytes[offset] !== 4 ||
          ((bytes[offset + 1] ?? 0) & 0xe0) !== 0 ||
          bytes[offset + 5] !== 0
        ) {
          invalidContainer("GIF graphic control extension is invalid.");
        }
        pendingTransparency = Boolean((bytes[offset + 1] ?? 0) & 1);
        offset += 6;
      } else {
        if (label === 0xff) {
          requireGifBytes(bytes, sourceByteLength, offset, 1, "an application extension size");
          const applicationLength = bytes[offset] ?? 0;
          if (applicationLength === 11) {
            requireGifBytes(bytes, sourceByteLength, offset + 1, 11, "an application identifier");
            const applicationIdentifier = ascii(bytes, offset + 1, offset + 12);
            if (applicationIdentifier === "XMP DataXMP") xmp = "present";
            if (applicationIdentifier === "ICCRGBG1012") colorProfile = "unknown";
          }
        }
        offset = skipSubBlocks(bytes, sourceByteLength, offset, blockBudget);
        if (label === 0x01) pendingTransparency = false;
      }
      continue;
    }

    if (marker !== 0x2c) invalidContainer("GIF contains an unknown block marker.");
    requireGifBytes(bytes, sourceByteLength, offset, 9, "an image descriptor");
    const left = view.getUint16(offset, true);
    const top = view.getUint16(offset + 2, true);
    const frameWidth = view.getUint16(offset + 4, true);
    const frameHeight = view.getUint16(offset + 6, true);
    const imagePacked = bytes[offset + 8] ?? 0;
    if ((imagePacked & 0x18) !== 0) invalidContainer("GIF image descriptor reserved bits are set.");
    if (
      frameWidth === 0 ||
      frameHeight === 0 ||
      left + frameWidth > width ||
      top + frameHeight > height
    ) {
      invalidContainer("GIF frame dimensions exceed its logical screen.");
    }
    offset += 9;
    if ((imagePacked & 0x80) !== 0) {
      const localColorTableBytes = 3 * 2 ** ((imagePacked & 0x07) + 1);
      requireGifBytes(bytes, sourceByteLength, offset, localColorTableBytes, "a local color table");
      offset += localColorTableBytes;
    }
    requireGifBytes(bytes, sourceByteLength, offset, 1, "the LZW code size");
    const minimumCodeSize = bytes[offset] ?? 0;
    if (minimumCodeSize < 2 || minimumCodeSize > 8) {
      invalidContainer("GIF LZW code size is invalid.");
    }
    offset = skipSubBlocks(bytes, sourceByteLength, offset + 1, blockBudget);
    frameCount += 1;
    if (pendingTransparency) alpha = "present";
    pendingTransparency = false;
  }
}
