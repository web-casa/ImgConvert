import {
  isConversionFailure,
  isRasterOutputFormat,
  type ConversionOutcome,
  type ConversionRequest,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import { MAX_RASTER_OUTPUT_BYTES } from "./bounds.js";

export interface ConversionWorkerCommand {
  readonly executionId: string;
  readonly request: ConversionRequest;
  readonly schemaVersion: 1;
  readonly type: "convert";
}

export interface ConversionWorkerResult {
  readonly executionId: string;
  readonly outcome: ConversionOutcome;
  readonly schemaVersion: 1;
  readonly type: "result";
}

export const CONVERSION_PROGRESS_PHASES = [
  "loading",
  "rendering",
  "decoding",
  "resizing",
  "encoding",
  "validating",
] as const;

export type ConversionProgressPhase = (typeof CONVERSION_PROGRESS_PHASES)[number];

export interface ConversionWorkerProgress {
  readonly executionId: string;
  readonly phase: ConversionProgressPhase;
  readonly progress: number;
  readonly schemaVersion: 1;
  readonly type: "progress";
}

const progressPhases = new Set<string>(CONVERSION_PROGRESS_PHASES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isConversionOutcome(value: unknown, limits: ResourceLimits): value is ConversionOutcome {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return isConversionFailure(value.failure);
  if (!isRecord(value.result)) return false;
  const { bytes, durationMs, format, height, width } = value.result;
  if (
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_RASTER_OUTPUT_BYTES ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    !isRasterOutputFormat(format) ||
    !isPositiveSafeInteger(width) ||
    !isPositiveSafeInteger(height)
  ) {
    return false;
  }
  const pixels = BigInt(width) * BigInt(height);
  return pixels <= BigInt(limits.maxRuntimePixels);
}

export function isConversionWorkerResult(
  value: unknown,
  limits: ResourceLimits,
): value is ConversionWorkerResult {
  return (
    isRecord(value) &&
    value.type === "result" &&
    value.schemaVersion === 1 &&
    typeof value.executionId === "string" &&
    value.executionId.length > 0 &&
    isConversionOutcome(value.outcome, limits)
  );
}

export function isConversionWorkerProgress(value: unknown): value is ConversionWorkerProgress {
  return (
    isRecord(value) &&
    value.type === "progress" &&
    value.schemaVersion === 1 &&
    typeof value.executionId === "string" &&
    value.executionId.length > 0 &&
    typeof value.phase === "string" &&
    progressPhases.has(value.phase) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1
  );
}
