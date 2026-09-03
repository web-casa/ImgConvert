import type { MetadataPolicy } from "./capabilities.js";
import type { ConversionFailure } from "./errors.js";
import {
  isImageInputFormat,
  isRasterOutputFormat,
  type RasterizableInputFormat,
  type RasterOutputFormat,
} from "./formats.js";
import { WEB_V1_DESKTOP_LIMITS, type ResourceLimits } from "./limits.js";

export type AlphaState = "absent" | "present" | "unknown";
export type AnimationState = "animated" | "static" | "unknown";
export type ColorProfileState = "none" | "srgb" | "nonSrgb" | "unknown";
export type MetadataPresence = "absent" | "present" | "unknown";
export type OrientationState = number | "unknown" | null;

const alphaStates = new Set<AlphaState>(["absent", "present", "unknown"]);
const animationStates = new Set<AnimationState>(["animated", "static", "unknown"]);
const colorProfileStates = new Set<ColorProfileState>(["none", "srgb", "nonSrgb", "unknown"]);
const metadataPolicies = new Set<MetadataPolicy>(["stripAll", "preserveAll"]);
const metadataPresenceStates = new Set<MetadataPresence>(["absent", "present", "unknown"]);

export interface ProbeResult {
  readonly alpha: AlphaState;
  readonly animation: AnimationState;
  readonly byteLength: number;
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

export interface ConversionSettings {
  readonly background: Readonly<{ blue: number; green: number; red: number }>;
  readonly lossless: boolean;
  readonly metadata: MetadataPolicy;
  readonly output: RasterOutputFormat;
  readonly quality: number | null;
  readonly resize: Readonly<{ height: number; width: number }> | null;
}

export interface ConversionRequest {
  readonly input: Readonly<{
    bytes: ArrayBuffer;
    name: string;
    probe: ProbeResult;
  }>;
  readonly jobId: string;
  readonly schemaVersion: 1;
  readonly settings: ConversionSettings;
}

export interface ConversionSuccess {
  readonly bytes: ArrayBuffer;
  readonly durationMs: number;
  readonly format: RasterOutputFormat;
  readonly height: number;
  readonly width: number;
}

export type ConversionOutcome =
  | { readonly failure: ConversionFailure; readonly ok: false }
  | { readonly ok: true; readonly result: ConversionSuccess };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function assertPixelBudget(width: number, height: number, limits: ResourceLimits): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.absolutePixels) {
    throw new RangeError("Image dimensions exceed the absolute pixel limit.");
  }
  if (pixels > limits.maxRuntimePixels) {
    throw new RangeError("Image dimensions exceed the runtime pixel budget.");
  }
}

function assertProbeResult(value: unknown, limits: ResourceLimits): asserts value is ProbeResult {
  if (!isRecord(value)) throw new TypeError("input.probe must be an object.");
  if (!isImageInputFormat(value.format) || value.format === "pdf") {
    throw new TypeError("input.probe.format is unsupported.");
  }
  if (!isPositiveSafeInteger(value.byteLength)) {
    throw new TypeError("input.probe.byteLength must be a positive safe integer.");
  }
  if (!isPositiveSafeInteger(value.width) || !isPositiveSafeInteger(value.height)) {
    throw new TypeError("input.probe dimensions must be positive safe integers.");
  }
  assertPixelBudget(value.width, value.height, limits);
  if (!alphaStates.has(value.alpha as AlphaState)) {
    throw new TypeError("input.probe.alpha is invalid.");
  }
  if (!animationStates.has(value.animation as AnimationState)) {
    throw new TypeError("input.probe.animation is invalid.");
  }
  if (!colorProfileStates.has(value.colorProfile as ColorProfileState)) {
    throw new TypeError("input.probe.colorProfile is invalid.");
  }
  if (!isRecord(value.metadata)) throw new TypeError("input.probe.metadata must be an object.");
  if (
    !metadataPresenceStates.has(value.metadata.exif as MetadataPresence) ||
    !metadataPresenceStates.has(value.metadata.iptc as MetadataPresence) ||
    !metadataPresenceStates.has(value.metadata.xmp as MetadataPresence)
  ) {
    throw new TypeError("input.probe metadata presence states are invalid.");
  }
  if (
    value.metadata.orientation !== null &&
    value.metadata.orientation !== "unknown" &&
    (!Number.isSafeInteger(value.metadata.orientation) ||
      (value.metadata.orientation as number) < 1 ||
      (value.metadata.orientation as number) > 8)
  ) {
    throw new TypeError(
      'input.probe.metadata.orientation must be null, "unknown", or an integer from 1 to 8.',
    );
  }
}

function assertRgb(value: unknown): void {
  if (!isRecord(value)) throw new TypeError("settings.background must be an object.");
  for (const channel of ["red", "green", "blue"] as const) {
    const component = value[channel];
    if (!Number.isInteger(component) || (component as number) < 0 || (component as number) > 255) {
      throw new RangeError(`settings.background.${channel} must be an integer from 0 to 255.`);
    }
  }
}

export function assertConversionSettings(
  value: unknown,
  limits: ResourceLimits,
): asserts value is ConversionSettings {
  if (!isRecord(value)) throw new TypeError("settings must be an object.");
  if (!isRasterOutputFormat(value.output)) throw new TypeError("settings.output is unsupported.");
  if (typeof value.lossless !== "boolean") {
    throw new TypeError("settings.lossless must be boolean.");
  }
  if (!metadataPolicies.has(value.metadata as MetadataPolicy)) {
    throw new TypeError("settings.metadata is invalid.");
  }
  assertRgb(value.background);

  if (value.resize !== null) {
    if (
      !isRecord(value.resize) ||
      !isPositiveSafeInteger(value.resize.width) ||
      !isPositiveSafeInteger(value.resize.height)
    ) {
      throw new TypeError("settings.resize must be null or contain positive integer dimensions.");
    }
    assertPixelBudget(value.resize.width, value.resize.height, limits);
  }

  if (value.quality !== null) {
    if (
      typeof value.quality !== "number" ||
      !Number.isInteger(value.quality) ||
      value.quality < 1 ||
      value.quality > 100
    ) {
      throw new RangeError("settings.quality must be null or an integer from 1 to 100.");
    }
  }
  if (value.output === "png") {
    if (!value.lossless || value.quality !== null) {
      throw new TypeError("PNG settings must be lossless and must not contain a quality value.");
    }
  } else if (value.output === "jpeg") {
    if (value.lossless || value.quality === null) {
      throw new TypeError("JPEG settings require a quality value and cannot be lossless.");
    }
  } else if (value.lossless ? value.quality !== null : value.quality === null) {
    throw new TypeError("WebP/AVIF quality must be null only when lossless is enabled.");
  }
}

export function assertConversionRequest(
  value: unknown,
  limits: ResourceLimits = WEB_V1_DESKTOP_LIMITS,
): asserts value is ConversionRequest {
  if (!isRecord(value)) throw new TypeError("Conversion request must be an object.");
  if (value.schemaVersion !== 1) throw new TypeError("Conversion request schemaVersion must be 1.");
  if (typeof value.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.jobId)) {
    throw new TypeError("Conversion request jobId is invalid.");
  }
  if (!isRecord(value.input)) throw new TypeError("Conversion request input must be an object.");
  if (!(value.input.bytes instanceof ArrayBuffer) || value.input.bytes.byteLength < 1) {
    throw new TypeError("input.bytes must be a non-empty ArrayBuffer.");
  }
  if (
    typeof value.input.name !== "string" ||
    value.input.name.length < 1 ||
    value.input.name.length > 1024 ||
    containsControlCharacter(value.input.name)
  ) {
    throw new TypeError("input.name is invalid.");
  }
  assertProbeResult(value.input.probe, limits);
  if (value.input.probe.byteLength !== value.input.bytes.byteLength) {
    throw new TypeError("input.probe.byteLength does not match input.bytes.");
  }
  const maxInputBytes =
    value.input.probe.format === "svg" ? limits.maxSvgBytes : limits.maxRasterBytes;
  if (value.input.bytes.byteLength > maxInputBytes) {
    throw new RangeError("input.bytes exceeds the format-specific byte limit.");
  }
  assertConversionSettings(value.settings, limits);
}
