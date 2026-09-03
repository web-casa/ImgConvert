import {
  isConversionFailure,
  isRasterOutputFormat,
  type PdfConversionOutcome,
  type PdfConversionRequest,
  type ResourceLimits,
} from "@imgconvert/conversion-contract";

import { CONVERSION_PROGRESS_PHASES, type ConversionProgressPhase } from "./worker-protocol.js";
import { MAX_RASTER_OUTPUT_BYTES } from "./bounds.js";

export interface PdfConversionWorkerCommand {
  readonly executionId: string;
  readonly request: PdfConversionRequest;
  readonly schemaVersion: 1;
  readonly type: "convert-pdf";
}

export interface PdfConversionWorkerProgress {
  readonly executionId: string;
  readonly pageIndex: number;
  readonly pageNumber: number;
  readonly pageTotal: number;
  readonly phase: ConversionProgressPhase;
  readonly progress: number;
  readonly schemaVersion: 1;
  readonly type: "pdf-progress";
}

export interface PdfConversionWorkerResult {
  readonly executionId: string;
  readonly outcome: PdfConversionOutcome;
  readonly schemaVersion: 1;
  readonly type: "pdf-result";
}

const progressPhases = new Set<string>(CONVERSION_PROGRESS_PHASES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isPdfOutcome(value: unknown, limits: ResourceLimits): value is PdfConversionOutcome {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return isConversionFailure(value.failure);
  if (!isRecord(value.result)) return false;
  const { durationMs, pageCount, pages } = value.result;
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    !isPositiveSafeInteger(pageCount) ||
    pageCount > limits.maxPdfPages ||
    !Array.isArray(pages) ||
    pages.length < 1 ||
    pages.length > limits.maxSelectedPdfPages
  ) {
    return false;
  }
  const pageNumbers = new Set<number>();
  for (const page of pages) {
    if (
      !isRecord(page) ||
      typeof page.ok !== "boolean" ||
      !isPositiveSafeInteger(page.pageNumber)
    ) {
      return false;
    }
    if (page.pageNumber > pageCount || pageNumbers.has(page.pageNumber)) return false;
    pageNumbers.add(page.pageNumber);
    if (!page.ok) {
      if (!isConversionFailure(page.failure)) return false;
      continue;
    }
    if (!isRecord(page.result) || page.result.pageNumber !== page.pageNumber) return false;
    const { bytes, format, height, width, durationMs: pageDuration } = page.result;
    if (
      !(bytes instanceof ArrayBuffer) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > MAX_RASTER_OUTPUT_BYTES ||
      !isRasterOutputFormat(format) ||
      !isPositiveSafeInteger(width) ||
      !isPositiveSafeInteger(height) ||
      typeof pageDuration !== "number" ||
      !Number.isFinite(pageDuration) ||
      pageDuration < 0 ||
      BigInt(width) * BigInt(height) > BigInt(limits.maxRuntimePixels)
    ) {
      return false;
    }
  }
  return true;
}

export function isPdfConversionWorkerProgress(
  value: unknown,
): value is PdfConversionWorkerProgress {
  return (
    isRecord(value) &&
    value.type === "pdf-progress" &&
    value.schemaVersion === 1 &&
    typeof value.executionId === "string" &&
    value.executionId.length > 0 &&
    typeof value.phase === "string" &&
    progressPhases.has(value.phase) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1 &&
    Number.isSafeInteger(value.pageIndex) &&
    (value.pageIndex as number) >= 0 &&
    isPositiveSafeInteger(value.pageNumber) &&
    isPositiveSafeInteger(value.pageTotal) &&
    (value.pageIndex as number) < (value.pageTotal as number)
  );
}

export function isPdfConversionWorkerResult(
  value: unknown,
  limits: ResourceLimits,
): value is PdfConversionWorkerResult {
  return (
    isRecord(value) &&
    value.type === "pdf-result" &&
    value.schemaVersion === 1 &&
    typeof value.executionId === "string" &&
    value.executionId.length > 0 &&
    isPdfOutcome(value.outcome, limits)
  );
}
