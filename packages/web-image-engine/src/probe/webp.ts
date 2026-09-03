import {
  ascii,
  invalidContainer,
  matches,
  readUint24LittleEndian,
  readUint32LittleEndian,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

function parseVp8Dimensions(data: Uint8Array): { height: number; width: number } {
  requireBytes(data, 0, 10, "WebP VP8 frame header");
  if (((data[0] ?? 1) & 1) !== 0) invalidContainer("WebP simple VP8 payload must be a key frame.");
  if (!matches(data, 3, [0x9d, 0x01, 0x2a])) invalidContainer("WebP VP8 start code is invalid.");
  const width = (((data[7] ?? 0) << 8) | (data[6] ?? 0)) & 0x3fff;
  const height = (((data[9] ?? 0) << 8) | (data[8] ?? 0)) & 0x3fff;
  if (width === 0 || height === 0) invalidContainer("WebP VP8 dimensions must be non-zero.");
  return { height, width };
}

function parseVp8lDimensions(data: Uint8Array): {
  alpha: ParsedRasterHeader["alpha"];
  height: number;
  width: number;
} {
  requireBytes(data, 0, 5, "WebP VP8L header");
  if (data[0] !== 0x2f) invalidContainer("WebP VP8L signature is invalid.");
  const width = 1 + ((data[1] ?? 0) | (((data[2] ?? 0) & 0x3f) << 8));
  const height =
    1 + (((data[2] ?? 0) >>> 6) | ((data[3] ?? 0) << 2) | (((data[4] ?? 0) & 0x0f) << 10));
  return { alpha: (data[4] ?? 0) & 0x10 ? "present" : "absent", height, width };
}

export function parseWebpHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  requireBytes(bytes, 0, 20, "WebP container header");
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") {
    invalidContainer("WebP RIFF signature is invalid.");
  }
  const declaredFileLength = readUint32LittleEndian(bytes, 4) + 8;
  if (declaredFileLength !== sourceByteLength) {
    invalidContainer("WebP RIFF size does not match the source file.");
  }

  const chunkType = ascii(bytes, 12, 16);
  const chunkLength = readUint32LittleEndian(bytes, 16);
  const chunkEnd = 20 + chunkLength;
  const paddedChunkEnd = chunkEnd + (chunkLength & 1);
  if (paddedChunkEnd > sourceByteLength) {
    invalidContainer("WebP first chunk exceeds the source file.");
  }
  requireBytes(bytes, 20, chunkLength, `WebP ${chunkType} chunk`);
  const data = bytes.subarray(20, chunkEnd);

  if (chunkType === "VP8X") {
    requireBytes(data, 0, 10, "WebP VP8X payload");
    if (chunkLength !== 10) invalidContainer("WebP VP8X chunk must contain exactly 10 bytes.");
    const flags = data[0] ?? 0;
    if ((flags & 0xc1) !== 0) invalidContainer("WebP VP8X reserved feature bits are set.");
    if (data[1] !== 0 || data[2] !== 0 || data[3] !== 0) {
      invalidContainer("WebP VP8X reserved bytes must be zero.");
    }
    const width = readUint24LittleEndian(data, 4) + 1;
    const height = readUint24LittleEndian(data, 7) + 1;
    const hasIcc = Boolean(flags & 0x20);
    const hasAlpha = Boolean(flags & 0x10);
    const hasExif = Boolean(flags & 0x08);
    const hasXmp = Boolean(flags & 0x04);
    const animated = Boolean(flags & 0x02);
    return {
      alpha: hasAlpha ? "present" : "absent",
      animation: animated ? "animated" : "static",
      colorProfile: hasIcc ? "unknown" : "none",
      format: "webp",
      height,
      metadata: {
        exif: hasExif ? "present" : "absent",
        iptc: "absent",
        orientation: hasExif ? "unknown" : null,
        xmp: hasXmp ? "present" : "absent",
      },
      width,
    };
  }

  if (chunkType === "VP8 ") {
    const { height, width } = parseVp8Dimensions(data);
    return {
      alpha: "absent",
      animation: "static",
      colorProfile: "none",
      format: "webp",
      height,
      metadata: { exif: "absent", iptc: "absent", orientation: null, xmp: "absent" },
      width,
    };
  }

  if (chunkType === "VP8L") {
    const { alpha, height, width } = parseVp8lDimensions(data);
    return {
      alpha,
      animation: "static",
      colorProfile: "none",
      format: "webp",
      height,
      metadata: { exif: "absent", iptc: "absent", orientation: null, xmp: "absent" },
      width,
    };
  }

  invalidContainer(`WebP first chunk ${chunkType} is not VP8, VP8L, or VP8X.`);
}
