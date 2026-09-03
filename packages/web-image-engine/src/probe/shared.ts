import type {
  AlphaState,
  AnimationState,
  ColorProfileState,
  MetadataPresence,
  OrientationState,
  RasterizableInputFormat,
} from "@imgconvert/conversion-contract";

export const DEFAULT_MAX_PROBE_BYTES = 1024 * 1024;
export const MAX_CONTAINER_BOXES = 4096;

export type HeaderProbeErrorCode =
  | "animated-input"
  | "input-too-large"
  | "invalid-container"
  | "pixel-budget-exceeded"
  | "probe-limit-exceeded"
  | "unsafe-pdf"
  | "unsafe-svg"
  | "unsupported-input";

export type ProbeErrorDetail = boolean | number | string | null;

export class HeaderProbeError extends Error {
  readonly code: HeaderProbeErrorCode;
  readonly details: Readonly<Record<string, ProbeErrorDetail>>;

  constructor(
    code: HeaderProbeErrorCode,
    message: string,
    details: Readonly<Record<string, ProbeErrorDetail>> = {},
  ) {
    super(message);
    this.name = "HeaderProbeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface ParsedRasterHeader {
  readonly alpha: AlphaState;
  readonly animation: AnimationState;
  readonly colorProfile: ColorProfileState;
  readonly format: RasterizableInputFormat;
  readonly height: number;
  readonly metadata: Readonly<{
    exif: MetadataPresence;
    iptc: MetadataPresence;
    orientation: OrientationState;
    xmp: MetadataPresence;
  }>;
  readonly width: number;
}

export function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let offset = start; offset < end; offset += 1) {
    value += String.fromCharCode(bytes[offset] ?? 0);
  }
  return value;
}

export function matches(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

export function requireBytes(
  bytes: Uint8Array,
  start: number,
  length: number,
  context: string,
): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start + length > bytes.byteLength
  ) {
    throw new HeaderProbeError(
      "probe-limit-exceeded",
      `${context} is not fully available inside the bounded probe window.`,
    );
  }
}

export function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 2, "16-bit field");
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

export function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 2, "16-bit field");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

export function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 3, "24-bit field");
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

export function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 4, "32-bit field");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

export function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 4, "32-bit field");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function readInt32LittleEndian(bytes: Uint8Array, offset: number): number {
  requireBytes(bytes, offset, 4, "signed 32-bit field");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

export function invalidContainer(message: string): never {
  throw new HeaderProbeError("invalid-container", message);
}

export function metadataUnknown(): ParsedRasterHeader["metadata"] {
  return {
    exif: "unknown",
    iptc: "unknown",
    orientation: "unknown",
    xmp: "unknown",
  };
}
