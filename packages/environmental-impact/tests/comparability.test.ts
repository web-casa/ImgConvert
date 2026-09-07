// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  measureComparableRasterReduction,
  summarizeComparableRasterReductions,
  type RasterComparisonEntry,
} from "../src/index.js";
const entry = (size: number, output: number): RasterComparisonEntry => ({
  state: "done",
  size,
  probe: { format: "png", animation: "static" },
  result: { size: output },
});

describe("shared Web and extension eligibility", () => {
  it("excludes unknown, failed, cancelled, animated and multi-output artifacts", () => {
    for (const state of ["ready", "failed", "cancelled", "converting"])
      expect(measureComparableRasterReduction({ ...entry(1000, 100), state })).toBeUndefined();
    for (const format of ["pdf", "svg", "gif", "unknown"])
      expect(
        measureComparableRasterReduction({
          ...entry(1000, 100),
          probe: { format, animation: "static" },
        }),
      ).toBeUndefined();
    for (const animation of ["animated", "unknown"])
      expect(
        measureComparableRasterReduction({
          ...entry(1000, 100),
          probe: { format: "webp", animation },
        }),
      ).toBeUndefined();
    expect(
      measureComparableRasterReduction({ ...entry(1000, 100), additionalResults: [{}] }),
    ).toBeUndefined();
    expect(
      measureComparableRasterReduction({ ...entry(1000, 100), probe: undefined }),
    ).toBeUndefined();
  });
  it("deducts larger outputs and does not accumulate repeated reads", () => {
    const entries = [entry(1000, 100), entry(100, 1200)];
    expect(summarizeComparableRasterReductions(entries)?.measurement).toMatchObject({
      byteDifference: -200,
      savedBytes: 0,
    });
    expect(summarizeComparableRasterReductions(entries)).toEqual(
      summarizeComparableRasterReductions(entries),
    );
    expect(summarizeComparableRasterReductions([])).toBeUndefined();
  });
  it("rejects unsafe byte totals before presenting estimates", () => {
    expect(() =>
      summarizeComparableRasterReductions([entry(Number.MAX_SAFE_INTEGER, 1), entry(1, 1)]),
    ).toThrow(/numeric range/);
    expect(() => measureComparableRasterReduction(entry(-1, 1))).toThrow();
  });
});
