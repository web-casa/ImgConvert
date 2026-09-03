import {
  WEB_V1_DESKTOP_LIMITS,
  assertConversionRequest,
  createConversionFailure,
  isRasterOutputFormat,
  type ConversionOutcome,
  type ConversionRequest,
  type ConversionSettings,
  type RasterizableInputFormat,
  type RasterOutputFormat,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import { HeaderProbeError, probeRasterHeader } from "./probe/index.js";
import { MAX_RASTER_OUTPUT_BYTES } from "./bounds.js";
import type { ConversionProgressPhase } from "./worker-protocol.js";

export { MAX_RASTER_OUTPUT_BYTES } from "./bounds.js";

export interface RasterCodecAdapter {
  decode(format: Exclude<RasterizableInputFormat, "svg">, bytes: ArrayBuffer): Promise<ImageData>;
  encode(
    format: RasterOutputFormat,
    image: ImageData,
    settings: ConversionSettings,
  ): Promise<ArrayBuffer>;
}

export interface RasterConversionProgress {
  readonly phase: ConversionProgressPhase;
  readonly progress: number;
}

export type RasterProgressReporter = (progress: RasterConversionProgress) => void;

function report(
  reporter: RasterProgressReporter | undefined,
  phase: ConversionProgressPhase,
  progress: number,
): void {
  reporter?.(Object.freeze({ phase, progress }));
}

function validImageData(image: ImageData, limits: ResourceLimits): boolean {
  const pixels = image.width * image.height;
  return (
    Number.isSafeInteger(pixels) &&
    image.width > 0 &&
    image.height > 0 &&
    pixels <= limits.maxRuntimePixels &&
    image.data instanceof Uint8ClampedArray &&
    image.data.byteLength === pixels * 4
  );
}

function decodedSourceDimensions(
  probe: Readonly<{ height: number; metadata: { orientation: unknown }; width: number }>,
): {
  height: number;
  width: number;
} {
  const orientation = probe.metadata.orientation;
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
    ? { height: probe.width, width: probe.height }
    : { height: probe.height, width: probe.width };
}

export function imageHasTransparency(image: ImageData): boolean {
  for (let offset = 3; offset < image.data.byteLength; offset += 4) {
    if (image.data[offset] !== 255) return true;
  }
  return false;
}

export function flattenAlpha(
  image: ImageData,
  background: ConversionSettings["background"],
): ImageData {
  const pixels = new Uint8ClampedArray(image.data.byteLength);
  const backgroundChannels = [background.red, background.green, background.blue] as const;
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const foreground = image.data[offset + channel] ?? 0;
      const backdrop = backgroundChannels[channel] ?? 0;
      pixels[offset + channel] = Math.round((foreground * alpha + backdrop * (255 - alpha)) / 255);
    }
    pixels[offset + 3] = 255;
  }
  return new ImageData(pixels, image.width, image.height);
}

export function resizeBilinear(image: ImageData, width: number, height: number): ImageData {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Resize dimensions must be positive safe integers.");
  }
  if (width === image.width && height === image.height) return image;

  const output = new Uint8ClampedArray(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    const sourceY = Math.max(0, (destinationY + 0.5) * scaleY - 0.5);
    const top = Math.min(image.height - 1, Math.floor(sourceY));
    const bottom = Math.min(image.height - 1, top + 1);
    const yWeight = sourceY - top;
    for (let destinationX = 0; destinationX < width; destinationX += 1) {
      const sourceX = Math.max(0, (destinationX + 0.5) * scaleX - 0.5);
      const left = Math.min(image.width - 1, Math.floor(sourceX));
      const right = Math.min(image.width - 1, left + 1);
      const xWeight = sourceX - left;
      const destinationOffset = (destinationY * width + destinationX) * 4;
      const topLeftOffset = (top * image.width + left) * 4;
      const topRightOffset = (top * image.width + right) * 4;
      const bottomLeftOffset = (bottom * image.width + left) * 4;
      const bottomRightOffset = (bottom * image.width + right) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const topValue =
          (image.data[topLeftOffset + channel] ?? 0) * (1 - xWeight) +
          (image.data[topRightOffset + channel] ?? 0) * xWeight;
        const bottomValue =
          (image.data[bottomLeftOffset + channel] ?? 0) * (1 - xWeight) +
          (image.data[bottomRightOffset + channel] ?? 0) * xWeight;
        output[destinationOffset + channel] = Math.round(
          topValue * (1 - yWeight) + bottomValue * yWeight,
        );
      }
    }
  }
  return new ImageData(output, width, height);
}

function failure(
  code: Parameters<typeof createConversionFailure>[0],
  params: Readonly<Record<string, boolean | number | string | null>> = {},
): ConversionOutcome {
  return Object.freeze({ failure: createConversionFailure(code, true, params), ok: false });
}

export async function convertRasterRequest(
  request: ConversionRequest,
  codecs: RasterCodecAdapter,
  onProgress?: RasterProgressReporter,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): Promise<ConversionOutcome> {
  try {
    assertConversionRequest(request, limits);
  } catch {
    return failure("invalid-settings");
  }
  if (
    !isRasterOutputFormat(request.input.probe.format) &&
    request.input.probe.format !== "bmp" &&
    request.input.probe.format !== "gif"
  ) {
    return failure("unsupported-input", { format: request.input.probe.format });
  }
  if (request.input.probe.animation !== "static") {
    return failure("animated-input", { format: request.input.probe.format });
  }
  if (request.input.probe.colorProfile !== "none" && request.input.probe.colorProfile !== "srgb") {
    return failure("unsupported-color-profile", { format: request.input.probe.format });
  }

  let verifiedProbe;
  try {
    verifiedProbe = probeRasterHeader(request.input.bytes, request.input.bytes.byteLength, {
      limits,
      maxProbeBytes: Math.max(64, request.input.bytes.byteLength),
    });
  } catch (error) {
    if (
      error instanceof HeaderProbeError &&
      (error.code === "animated-input" ||
        error.code === "input-too-large" ||
        error.code === "pixel-budget-exceeded")
    ) {
      return failure(error.code, error.details);
    }
    return failure("decode-failed", { format: request.input.probe.format });
  }
  if (
    verifiedProbe.format !== request.input.probe.format ||
    verifiedProbe.byteLength !== request.input.probe.byteLength ||
    verifiedProbe.width !== request.input.probe.width ||
    verifiedProbe.height !== request.input.probe.height
  ) {
    return failure("format-mismatch", { format: request.input.probe.format });
  }
  if (verifiedProbe.colorProfile !== "none" && verifiedProbe.colorProfile !== "srgb") {
    return failure("unsupported-color-profile", { format: verifiedProbe.format });
  }

  const startedAt = performance.now();
  report(onProgress, "loading", 0.05);
  const expectedSourceDimensions = decodedSourceDimensions(verifiedProbe);
  let source: ImageData;
  try {
    report(onProgress, "decoding", 0.18);
    source = await codecs.decode(request.input.probe.format, request.input.bytes);
    if (
      !validImageData(source, limits) ||
      source.width !== expectedSourceDimensions.width ||
      source.height !== expectedSourceDimensions.height
    ) {
      throw new Error("Decoded pixels do not match the verified input dimensions.");
    }
  } catch {
    return failure("decode-failed", { format: request.input.probe.format });
  }

  let prepared = source;
  try {
    report(onProgress, "resizing", 0.48);
    if (request.settings.resize) {
      prepared = resizeBilinear(
        prepared,
        request.settings.resize.width,
        request.settings.resize.height,
      );
    }
    if (request.settings.output === "jpeg" && imageHasTransparency(prepared)) {
      prepared = flattenAlpha(prepared, request.settings.background);
    }
  } catch {
    return failure("invalid-settings");
  }

  const sourceHasTransparency = imageHasTransparency(source);
  let bytes: ArrayBuffer;
  try {
    report(onProgress, "encoding", 0.64);
    bytes = await codecs.encode(request.settings.output, prepared, request.settings);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_RASTER_OUTPUT_BYTES) {
      throw new RangeError("Encoded output exceeds the bounded output size.");
    }
  } catch {
    return failure("encode-failed", { format: request.settings.output });
  }

  report(onProgress, "validating", 0.9);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RASTER_OUTPUT_BYTES) {
    return failure("output-validation-failed", {
      format: request.settings.output,
      reason: "output-size",
    });
  }
  let outputProbe;
  try {
    outputProbe = probeRasterHeader(bytes, bytes.byteLength, {
      limits: { ...limits, maxRasterBytes: MAX_RASTER_OUTPUT_BYTES },
      maxProbeBytes: Math.max(64, bytes.byteLength),
    });
  } catch (error) {
    return failure("output-validation-failed", {
      format: request.settings.output,
      reason: error instanceof HeaderProbeError ? `output-probe-${error.code}` : "output-probe",
    });
  }
  let decodedOutput: ImageData;
  try {
    decodedOutput = await codecs.decode(request.settings.output, bytes.slice(0));
  } catch {
    return failure("output-validation-failed", {
      format: request.settings.output,
      reason: "output-decode",
    });
  }
  try {
    if (outputProbe.format !== request.settings.output) {
      return failure("output-validation-failed", {
        format: request.settings.output,
        reason: "output-format",
      });
    }
    if (outputProbe.width !== prepared.width || outputProbe.height !== prepared.height) {
      return failure("output-validation-failed", {
        format: request.settings.output,
        reason: "header-dimensions",
      });
    }
    if (
      !validImageData(decodedOutput, limits) ||
      decodedOutput.width !== prepared.width ||
      decodedOutput.height !== prepared.height
    ) {
      return failure("output-validation-failed", {
        format: request.settings.output,
        reason: "decoded-dimensions",
      });
    }
    if (request.settings.output === "jpeg" && imageHasTransparency(decodedOutput)) {
      return failure("output-validation-failed", {
        format: request.settings.output,
        reason: "unexpected-alpha",
      });
    }
    if (
      sourceHasTransparency &&
      request.settings.output !== "jpeg" &&
      !imageHasTransparency(decodedOutput)
    ) {
      return failure("output-validation-failed", {
        format: request.settings.output,
        reason: "alpha-lost",
      });
    }
  } catch {
    return failure("output-validation-failed", {
      format: request.settings.output,
      reason: "output-conformance",
    });
  }

  return Object.freeze({
    ok: true,
    result: Object.freeze({
      bytes,
      durationMs: performance.now() - startedAt,
      format: request.settings.output,
      height: prepared.height,
      width: prepared.width,
    }),
  });
}

const EXTENSIONS: Readonly<Record<RasterOutputFormat, string>> = Object.freeze({
  avif: "avif",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
});

export function outputFileName(inputName: string, format: RasterOutputFormat): string {
  const withoutExtension = inputName.replace(/\.[^.]*$/u, "");
  const normalized = [...withoutExtension.normalize("NFC")]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      const isBidirectionalControl =
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069);
      return isControl || isBidirectionalControl ? "-" : character;
    })
    .join("");
  const sanitized = normalized
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[.\s-]+/gu, "")
    .replace(/[.\s]+$/gu, "")
    .trim()
    .slice(0, 180);
  const base = sanitized && sanitized !== "." ? sanitized : "converted-image";
  return `${base}.${EXTENSIONS[format]}`;
}

export function pdfPageOutputFileName(
  inputName: string,
  pageNumber: number,
  format: RasterOutputFormat,
): string {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError("PDF page number must be a positive safe integer.");
  }
  const outputName = outputFileName(inputName, format);
  const extensionIndex = outputName.lastIndexOf(".");
  return `${outputName.slice(0, extensionIndex)}-page-${String(pageNumber).padStart(3, "0")}${outputName.slice(extensionIndex)}`;
}

export function outputMimeType(format: RasterOutputFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}
