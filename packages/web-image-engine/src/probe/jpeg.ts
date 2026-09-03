import type { OrientationState } from "@imgconvert/conversion-contract";

import {
  HeaderProbeError,
  ascii,
  invalidContainer,
  matches,
  readUint16BigEndian,
  requireBytes,
  type ParsedRasterHeader,
} from "./shared.js";

const START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0] as const;
const XMP_PREFIX = "http://ns.adobe.com/xap/1.0/\0";
const ICC_PREFIX = "ICC_PROFILE\0";

function parseExifOrientation(segment: Uint8Array): OrientationState {
  if (!matches(segment, 0, EXIF_PREFIX) || segment.byteLength < 14) return "unknown";
  const tiffOffset = 6;
  const byteOrder = ascii(segment, tiffOffset, tiffOffset + 2);
  if (byteOrder !== "II" && byteOrder !== "MM") return "unknown";
  const littleEndian = byteOrder === "II";
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return "unknown";
  const firstIfdRelativeOffset = view.getUint32(tiffOffset + 4, littleEndian);
  const firstIfdOffset = tiffOffset + firstIfdRelativeOffset;
  if (firstIfdOffset < tiffOffset + 8 || firstIfdOffset + 2 > segment.byteLength) return "unknown";
  const entryCount = view.getUint16(firstIfdOffset, littleEndian);
  if (entryCount > 512) return "unknown";
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfdOffset + 2 + index * 12;
    if (entryOffset + 12 > segment.byteLength) return "unknown";
    if (view.getUint16(entryOffset, littleEndian) !== 0x0112) continue;
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    if (type !== 3 || count !== 1) return "unknown";
    const orientation = view.getUint16(entryOffset + 8, littleEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : "unknown";
  }
  return null;
}

export function parseJpegHeader(bytes: Uint8Array, sourceByteLength: number): ParsedRasterHeader {
  if (!matches(bytes, 0, [0xff, 0xd8])) invalidContainer("JPEG input lacks the SOI marker.");

  let offset = 2;
  let width: number | undefined;
  let height: number | undefined;
  let exif: ParsedRasterHeader["metadata"]["exif"] = "unknown";
  let iptc: ParsedRasterHeader["metadata"]["iptc"] = "unknown";
  let orientation: OrientationState = "unknown";
  let xmp: ParsedRasterHeader["metadata"]["xmp"] = "unknown";
  let colorProfile: ParsedRasterHeader["colorProfile"] = "none";

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) invalidContainer("JPEG marker prefix is invalid.");
    while (bytes[offset] === 0xff) offset += 1;
    requireBytes(bytes, offset, 1, "JPEG marker");
    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (marker === 0x00) invalidContainer("JPEG contains a stuffed byte outside entropy data.");
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      if (width === undefined || height === undefined) {
        invalidContainer("JPEG reached scan data before a supported SOF marker.");
      }
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    requireBytes(bytes, offset, 2, "JPEG segment length");
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2) invalidContainer("JPEG segment length is smaller than its header.");
    const segmentDataStart = offset + 2;
    const segmentDataLength = segmentLength - 2;
    const segmentEnd = segmentDataStart + segmentDataLength;
    if (segmentEnd > sourceByteLength) invalidContainer("JPEG segment exceeds the source file.");
    requireBytes(bytes, segmentDataStart, segmentDataLength, "JPEG segment");
    const segment = bytes.subarray(segmentDataStart, segmentEnd);

    if (marker === 0xe1 && matches(segment, 0, EXIF_PREFIX)) {
      exif = "present";
      orientation = parseExifOrientation(segment);
    } else if (marker === 0xe1 && ascii(segment, 0, XMP_PREFIX.length) === XMP_PREFIX) {
      xmp = "present";
    } else if (marker === 0xe2 && ascii(segment, 0, ICC_PREFIX.length) === ICC_PREFIX) {
      colorProfile = "unknown";
    } else if (marker === 0xed) {
      iptc = "present";
    }

    if (START_OF_FRAME_MARKERS.has(marker)) {
      if (segment.byteLength < 6) invalidContainer("JPEG SOF segment is truncated.");
      height = readUint16BigEndian(segment, 1);
      width = readUint16BigEndian(segment, 3);
      if (width === 0 || height === 0) invalidContainer("JPEG dimensions must be non-zero.");
    }
    offset = segmentEnd;
  }

  if (width === undefined || height === undefined) {
    if (bytes.byteLength === sourceByteLength) {
      invalidContainer("JPEG source contains no supported SOF marker.");
    }
    throw new HeaderProbeError(
      "probe-limit-exceeded",
      "JPEG SOF marker was not found inside the bounded probe window.",
    );
  }
  return {
    alpha: "absent",
    animation: "static",
    colorProfile,
    format: "jpeg",
    height,
    metadata: { exif, iptc, orientation, xmp },
    width,
  };
}
