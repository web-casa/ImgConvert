import {
  invalidContainer,
  matches,
  readInt32LittleEndian,
  readUint16LittleEndian,
  readUint32LittleEndian,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

const WINDOWS_DIB_HEADER_SIZES = new Set([40, 52, 56, 108, 124]);
const LCS_SRGB = 0x73524742;
const LCS_WINDOWS_COLOR_SPACE = 0x57696e20;

function checkedPixelEnd(
  pixelOffset: number,
  width: number,
  height: number,
  bitsPerPixel: number,
): number {
  const rowBits = BigInt(width) * BigInt(bitsPerPixel);
  const stride = ((rowBits + 31n) / 32n) * 4n;
  const end = BigInt(pixelOffset) + stride * BigInt(height);
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) invalidContainer("BMP pixel data size is invalid.");
  return Number(end);
}

export function parseBmpHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  requireBytes(bytes, 0, 26, "BMP file and DIB headers");
  if (!matches(bytes, 0, [0x42, 0x4d])) invalidContainer("BMP signature is invalid.");

  const declaredFileSize = readUint32LittleEndian(bytes, 2);
  const pixelOffset = readUint32LittleEndian(bytes, 10);
  const dibSize = readUint32LittleEndian(bytes, 14);
  if (declaredFileSize !== sourceByteLength) {
    invalidContainer("BMP file size does not match the source file.");
  }

  let width: number;
  let height: number;
  let bitsPerPixel: number;
  let alpha: ParsedRasterHeader["alpha"] = "absent";
  let colorProfile: ParsedRasterHeader["colorProfile"] = "none";

  if (dibSize === 12) {
    requireBytes(bytes, 14, dibSize, "BMP core header");
    width = readUint16LittleEndian(bytes, 18);
    height = readUint16LittleEndian(bytes, 20);
    const planes = readUint16LittleEndian(bytes, 22);
    bitsPerPixel = readUint16LittleEndian(bytes, 24);
    if (planes !== 1 || bitsPerPixel !== 24) {
      invalidContainer("Web BMP input supports 24-bit core bitmaps only.");
    }
  } else {
    if (!WINDOWS_DIB_HEADER_SIZES.has(dibSize)) {
      invalidContainer("BMP DIB header version is not supported.");
    }
    requireBytes(bytes, 14, dibSize, "BMP DIB header");
    width = readInt32LittleEndian(bytes, 18);
    const signedHeight = readInt32LittleEndian(bytes, 22);
    const planes = readUint16LittleEndian(bytes, 26);
    bitsPerPixel = readUint16LittleEndian(bytes, 28);
    const compression = readUint32LittleEndian(bytes, 30);
    if (width < 1 || signedHeight === 0 || signedHeight === -0x80000000) {
      invalidContainer("BMP dimensions must be positive and non-zero.");
    }
    height = Math.abs(signedHeight);
    if (planes !== 1 || (bitsPerPixel !== 24 && bitsPerPixel !== 32)) {
      invalidContainer("Web BMP input supports 24-bit and 32-bit pixels only.");
    }
    if (
      (bitsPerPixel === 24 && compression !== 0) ||
      (bitsPerPixel === 32 && compression !== 0 && compression !== 3 && compression !== 6)
    ) {
      invalidContainer("BMP compression or pixel masks are not supported.");
    }
    const maskBytes = dibSize === 40 && compression !== 0 ? (compression === 6 ? 16 : 12) : 0;
    if (pixelOffset < 14 + dibSize + maskBytes) {
      invalidContainer("BMP pixel offset overlaps its header or color masks.");
    }
    alpha = bitsPerPixel === 32 ? "unknown" : "absent";
    if (dibSize >= 108) {
      const colorSpace = readUint32LittleEndian(bytes, 70);
      if (colorSpace === LCS_SRGB || colorSpace === LCS_WINDOWS_COLOR_SPACE) {
        colorProfile = "srgb";
      } else {
        colorProfile = "unknown";
      }
    }
  }

  if (width < 1 || height < 1) invalidContainer("BMP dimensions must be non-zero.");
  if (pixelOffset < 14 + dibSize || pixelOffset > sourceByteLength) {
    invalidContainer("BMP pixel offset is outside the source file.");
  }
  if (checkedPixelEnd(pixelOffset, width, height, bitsPerPixel) > sourceByteLength) {
    invalidContainer("BMP pixel data is truncated.");
  }

  return {
    alpha,
    animation: "static",
    colorProfile,
    format: "bmp",
    height,
    metadata: { exif: "absent", iptc: "absent", orientation: null, xmp: "absent" },
    width,
  };
}
