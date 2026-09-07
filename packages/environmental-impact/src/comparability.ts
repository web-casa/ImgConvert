// SPDX-License-Identifier: Apache-2.0
import { measureByteReduction } from "./calculator.js";
import type { ByteReductionMeasurement } from "./types.js";

/** Minimal artifact facts, structurally compatible with browser queues. No DOM or runtime dependency. */
export interface RasterComparisonEntry {
  readonly state: string;
  readonly size: number;
  readonly probe?: { readonly format: string; readonly animation?: string } | undefined;
  readonly result?: { readonly size: number } | undefined;
  readonly additionalResults?: readonly unknown[] | undefined;
}

const COMPARABLE_RASTER_INPUTS = new Set(["avif", "bmp", "jpeg", "png", "webp"]);

export interface RasterReductionSummary {
  readonly measurement: ByteReductionMeasurement;
  readonly resultCount: number;
}

/**
 * Returns a byte measurement only when an input and its single output represent directly
 * comparable raster-image artifacts. PDF, SVG, GIF/animation, and multi-output conversions are
 * deliberately excluded from storage-reduction claims.
 */
export function measureComparableRasterReduction(
  entry: RasterComparisonEntry,
): ByteReductionMeasurement | undefined {
  if (
    entry.state !== "done" ||
    !entry.result ||
    !entry.probe ||
    entry.probe.format === "pdf" ||
    entry.probe.animation !== "static" ||
    !COMPARABLE_RASTER_INPUTS.has(entry.probe.format) ||
    (entry.additionalResults?.length ?? 0) > 0
  ) {
    return undefined;
  }
  return measureByteReduction(entry.size, entry.result.size);
}

/** Measures the queue's net byte reduction, so larger outputs offset smaller outputs. */
export function summarizeComparableRasterReductions(
  entries: readonly RasterComparisonEntry[],
): RasterReductionSummary | undefined {
  let inputBytes = 0;
  let outputBytes = 0;
  let resultCount = 0;

  for (const entry of entries) {
    const measurement = measureComparableRasterReduction(entry);
    if (!measurement) continue;
    inputBytes += measurement.inputBytes;
    outputBytes += measurement.outputBytes;
    resultCount += 1;
  }

  if (resultCount === 0) return undefined;
  if (!Number.isSafeInteger(inputBytes) || !Number.isSafeInteger(outputBytes)) {
    throw new RangeError("queue byte totals exceed the supported numeric range");
  }
  return Object.freeze({
    measurement: measureByteReduction(inputBytes, outputBytes),
    resultCount,
  });
}
