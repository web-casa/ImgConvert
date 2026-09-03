import {
  WEB_V1_DESKTOP_LIMITS,
  createResourceLimits,
  type ProbeResult,
  type RasterizableInputFormat,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import { parseAvifHeader } from "./avif.js";
import { parseBmpHeader } from "./bmp.js";
import { parseGifHeader } from "./gif.js";
import { parseJpegHeader } from "./jpeg.js";
import { parsePngHeader } from "./png.js";
import {
  DEFAULT_MAX_PROBE_BYTES,
  HeaderProbeError,
  matches,
  type ParsedRasterHeader,
} from "./shared.js";
import { parseWebpHeader } from "./webp.js";

export interface RasterProbeOptions {
  readonly limits?: ResourceLimits;
  readonly maxProbeBytes?: number;
}

function sniffRasterFormat(bytes: Uint8Array): RasterizableInputFormat {
  if (matches(bytes, 0, [0xff, 0xd8])) return "jpeg";
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (matches(bytes, 0, [0x42, 0x4d])) return "bmp";
  if (
    matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "gif";
  }
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.byteLength >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") {
    return "avif";
  }
  throw new HeaderProbeError(
    "unsupported-input",
    "Input magic does not match a Web v1 raster format.",
  );
}

function validateSourceByteLength(sourceByteLength: number, headerBytes: Uint8Array): void {
  if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength < 1) {
    throw new TypeError("sourceByteLength must be a positive safe integer.");
  }
  if (headerBytes.byteLength > sourceByteLength) {
    throw new TypeError("Header bytes cannot be longer than the source file.");
  }
}

function validateDimensions(parsed: ParsedRasterHeader, limits: ResourceLimits): void {
  const pixels = BigInt(parsed.width) * BigInt(parsed.height);
  if (pixels > BigInt(limits.absolutePixels) || pixels > BigInt(limits.maxRuntimePixels)) {
    throw new HeaderProbeError(
      "pixel-budget-exceeded",
      "Raster dimensions exceed the active Web runtime pixel budget.",
      {
        format: parsed.format,
        height: parsed.height,
        limitPixels: Math.min(limits.absolutePixels, limits.maxRuntimePixels),
        width: parsed.width,
      },
    );
  }
}

export function probeRasterHeader(
  input: ArrayBuffer | Uint8Array,
  sourceByteLength: number,
  options: RasterProbeOptions = {},
): ProbeResult {
  const limits = createResourceLimits(options.limits ?? WEB_V1_DESKTOP_LIMITS);
  const maxProbeBytes = options.maxProbeBytes ?? DEFAULT_MAX_PROBE_BYTES;
  if (
    !Number.isSafeInteger(maxProbeBytes) ||
    maxProbeBytes < 64 ||
    maxProbeBytes > limits.maxRasterBytes
  ) {
    throw new RangeError(
      `maxProbeBytes must be an integer from 64 bytes to ${limits.maxRasterBytes} bytes.`,
    );
  }
  const allBytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  validateSourceByteLength(sourceByteLength, allBytes);
  const bytes = allBytes.subarray(0, Math.min(allBytes.byteLength, maxProbeBytes));
  const format = sniffRasterFormat(bytes);
  if (sourceByteLength > limits.maxRasterBytes) {
    throw new HeaderProbeError("input-too-large", "Raster source exceeds the Web byte limit.", {
      format,
      limitBytes: limits.maxRasterBytes,
      sourceByteLength,
    });
  }

  let parsed: ParsedRasterHeader;
  switch (format) {
    case "jpeg":
      parsed = parseJpegHeader(bytes, sourceByteLength);
      break;
    case "png":
      parsed = parsePngHeader(bytes, sourceByteLength);
      break;
    case "webp":
      parsed = parseWebpHeader(bytes, sourceByteLength);
      break;
    case "avif":
      parsed = parseAvifHeader(bytes, sourceByteLength);
      break;
    case "bmp":
      parsed = parseBmpHeader(bytes, sourceByteLength);
      break;
    case "gif":
      parsed = parseGifHeader(bytes, sourceByteLength);
      break;
    case "svg":
      throw new HeaderProbeError("unsupported-input", "SVG requires the safe vector probe.");
  }
  if (parsed.animation === "animated") {
    throw new HeaderProbeError("animated-input", `Animated ${parsed.format} is not supported.`, {
      format: parsed.format,
    });
  }
  validateDimensions(parsed, limits);
  return Object.freeze({
    ...parsed,
    byteLength: sourceByteLength,
    metadata: Object.freeze({ ...parsed.metadata }),
  });
}

export { DEFAULT_MAX_PROBE_BYTES, HeaderProbeError } from "./shared.js";
export type { HeaderProbeErrorCode, ProbeErrorDetail } from "./shared.js";
