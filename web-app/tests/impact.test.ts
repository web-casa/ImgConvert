// SPDX-License-Identifier: Apache-2.0

import type { RasterizableInputFormat } from "@imgconvert/conversion-contract";
import { describe, expect, it } from "vitest";

import { resultDelta } from "../src/lib/format";
import { measureComparableEntryReduction, summarizeQueueByteReduction } from "../src/lib/impact";
import type { QueueConversionResult, QueueEntry } from "../src/lib/queue";

function result(size: number): QueueConversionResult {
  return {
    blob: new Blob([new Uint8Array(size)]),
    downloaded: false,
    durationMs: 1,
    format: "webp",
    height: 1,
    name: "result.webp",
    previewUrl: "blob:result",
    settings: {
      background: { blue: 255, green: 255, red: 255 },
      lossless: false,
      metadata: "stripAll",
      output: "webp",
      quality: 82,
      resize: null,
    },
    size,
    width: 1,
  };
}

function rasterEntry(
  inputBytes: number,
  outputBytes: number,
  format: RasterizableInputFormat = "png",
): QueueEntry {
  return {
    file: { size: inputBytes } as File,
    id: `${format}-${inputBytes}-${outputBytes}`,
    name: `input.${format}`,
    previewUrl: "blob:input",
    probe: {
      alpha: "absent",
      animation: "static",
      byteLength: inputBytes,
      colorProfile: "srgb",
      format,
      height: 1,
      metadata: { exif: "absent", iptc: "absent", orientation: null, xmp: "absent" },
      width: 1,
    },
    result: result(outputBytes),
    size: inputBytes,
    state: "done",
  };
}

describe("comparable byte reduction", () => {
  it("measures completed static raster conversions", () => {
    expect(measureComparableEntryReduction(rasterEntry(1_000, 400))).toMatchObject({
      byteDifference: 600,
      reductionFraction: 0.6,
      savedBytes: 600,
    });
  });

  it("excludes format-changing sources that cannot support an environmental claim", () => {
    expect(measureComparableEntryReduction(rasterEntry(1_000, 100, "svg"))).toBeUndefined();
    expect(measureComparableEntryReduction(rasterEntry(1_000, 100, "gif"))).toBeUndefined();

    const pending = rasterEntry(1_000, 100);
    pending.state = "ready";
    expect(measureComparableEntryReduction(pending)).toBeUndefined();
  });

  it("excludes animated and multi-output conversions from the one-to-one comparison", () => {
    const animated = rasterEntry(1_000, 100, "webp");
    const animatedProbe = animated.probe;
    if (!animatedProbe || animatedProbe.format === "pdf") throw new Error("expected raster probe");
    animated.probe = { ...animatedProbe, animation: "animated" };
    expect(measureComparableEntryReduction(animated)).toBeUndefined();

    const multiOutput = rasterEntry(1_000, 100);
    multiOutput.additionalResults = [result(50)];
    expect(measureComparableEntryReduction(multiOutput)).toBeUndefined();
  });

  it("uses the queue's net difference instead of overstating positive-only savings", () => {
    const summary = summarizeQueueByteReduction([
      rasterEntry(1_000, 400),
      rasterEntry(100, 200, "jpeg"),
    ]);

    expect(summary).toEqual({
      measurement: {
        byteDifference: 500,
        inputBytes: 1_100,
        outputBytes: 600,
        reductionFraction: 500 / 1_100,
        savedBytes: 500,
      },
      resultCount: 2,
    });
  });

  it("does not claim positive savings when larger results offset every reduction", () => {
    const entries = [rasterEntry(1_000, 500), rasterEntry(100, 900, "jpeg")];
    expect(summarizeQueueByteReduction(entries)?.measurement).toMatchObject({
      byteDifference: -300,
      savedBytes: 0,
    });
    // Repeated reads/download state changes cannot accumulate another contribution.
    entries[0]!.result!.downloaded = true;
    expect(summarizeQueueByteReduction(entries)?.measurement.savedBytes).toBe(0);
    expect(summarizeQueueByteReduction([])).toBeUndefined();
  });

  it("counts only completed comparable results in a mixed queue", () => {
    const failed = rasterEntry(100, 10);
    failed.state = "failed";
    const summary = summarizeQueueByteReduction([
      rasterEntry(1_000, 400),
      rasterEntry(10_000, 100, "svg"),
      failed,
    ]);
    expect(summary?.resultCount).toBe(1);
    expect(summary?.measurement.savedBytes).toBe(600);
  });

  it("returns no summary when the queue has no comparable result", () => {
    expect(summarizeQueueByteReduction([rasterEntry(1_000, 100, "svg")])).toBeUndefined();
  });
});

describe("measured result copy", () => {
  it("formats exact smaller, larger, and unchanged byte differences", () => {
    expect(
      resultDelta(
        rasterEntry(2_048, 1_024),
        "en-US",
        "{percent} smaller · {size} less",
        "{size} larger than source",
        "Same file size as source",
      ),
    ).toBe("50% smaller · 1 KiB less");
    expect(
      resultDelta(
        rasterEntry(1_024, 2_048),
        "en-US",
        "{percent} smaller · {size} less",
        "{size} larger than source",
        "Same file size as source",
      ),
    ).toBe("1 KiB larger than source");
    expect(
      resultDelta(
        rasterEntry(1_024, 1_024),
        "en-US",
        "{percent} smaller · {size} less",
        "{size} larger than source",
        "Same file size as source",
      ),
    ).toBe("Same file size as source");
  });

  it("does not round a non-empty output to a misleading 100% reduction", () => {
    expect(
      resultDelta(
        rasterEntry(20_790, 92),
        "en-US",
        "{percent} smaller · {size} less",
        "{size} larger than source",
        "Same file size as source",
      ),
    ).toBe("99.6% smaller · 20.2 KiB less");
  });
});
