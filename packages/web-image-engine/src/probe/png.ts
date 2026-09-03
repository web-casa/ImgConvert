import {
  HeaderProbeError,
  ascii,
  invalidContainer,
  matches,
  readUint32BigEndian,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parsePngHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  if (!matches(bytes, 0, PNG_SIGNATURE)) invalidContainer("PNG signature is invalid.");
  requireBytes(bytes, 8, 25, "PNG IHDR chunk");
  if (readUint32BigEndian(bytes, 8) !== 13 || ascii(bytes, 12, 16) !== "IHDR") {
    invalidContainer("PNG IHDR must be the first 13-byte chunk.");
  }
  const expectedIhdrCrc = readUint32BigEndian(bytes, 29);
  if (crc32(bytes.subarray(12, 29)) !== expectedIhdrCrc) {
    invalidContainer("PNG IHDR CRC is invalid.");
  }

  const width = readUint32BigEndian(bytes, 16);
  const height = readUint32BigEndian(bytes, 20);
  if (width === 0 || height === 0) invalidContainer("PNG dimensions must be non-zero.");
  const bitDepth = bytes[24] ?? 0;
  const colorType = bytes[25] ?? 255;
  const allowedBitDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!allowedBitDepths[colorType]?.includes(bitDepth)) {
    invalidContainer("PNG bit depth and color type combination is invalid.");
  }
  if (bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28] ?? -1)) {
    invalidContainer("PNG compression, filter, or interlace method is invalid.");
  }

  let alpha: ParsedRasterHeader["alpha"] =
    colorType === 4 || colorType === 6 ? "present" : "absent";
  let animation: ParsedRasterHeader["animation"] = "unknown";
  let colorProfile: ParsedRasterHeader["colorProfile"] = "none";
  let exif: ParsedRasterHeader["metadata"]["exif"] = "unknown";
  let xmp: ParsedRasterHeader["metadata"]["xmp"] = "unknown";
  let offset = 33;

  while (offset < bytes.byteLength) {
    requireBytes(bytes, offset, 8, "PNG chunk header");
    const length = readUint32BigEndian(bytes, offset);
    if (length > 0x7fffffff) invalidContainer("PNG chunk exceeds the specification limit.");
    const chunkDataStart = offset + 8;
    const chunkEnd = chunkDataStart + length + 4;
    if (chunkEnd > sourceByteLength) invalidContainer("PNG chunk exceeds the source file.");
    requireBytes(bytes, offset, 12 + length, "PNG chunk");
    const type = ascii(bytes, offset + 4, offset + 8);
    const data = bytes.subarray(chunkDataStart, chunkDataStart + length);
    const expectedCrc = readUint32BigEndian(bytes, chunkDataStart + length);
    if (crc32(bytes.subarray(offset + 4, chunkDataStart + length)) !== expectedCrc) {
      invalidContainer(`PNG ${type} CRC is invalid.`);
    }

    if (type === "acTL") animation = "animated";
    if (type === "tRNS") alpha = "present";
    if (type === "iCCP") colorProfile = "unknown";
    if (type === "sRGB") colorProfile = "srgb";
    if (type === "eXIf") exif = "present";
    if (type === "iTXt" && ascii(data, 0, Math.min(data.byteLength, 17)) === "XML:com.adobe.xmp") {
      xmp = "present";
    }
    if (type === "IDAT") {
      if (animation === "unknown") animation = "static";
      break;
    }
    if (type === "IEND") invalidContainer("PNG has no IDAT chunk before IEND.");
    offset = chunkEnd;
  }

  if (animation === "unknown") {
    if (bytes.byteLength === sourceByteLength) {
      invalidContainer("PNG source contains no IDAT chunk.");
    }
    throw new HeaderProbeError(
      "probe-limit-exceeded",
      "PNG did not reach its first IDAT chunk inside the bounded probe window.",
    );
  }
  return {
    alpha,
    animation,
    colorProfile,
    format: "png",
    height,
    metadata: { exif, iptc: "unknown", orientation: "unknown", xmp },
    width,
  };
}
