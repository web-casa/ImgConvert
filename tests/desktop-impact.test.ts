// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { captureDesktopImpact, summarizeDesktopImpact } from "../src/lib/desktop-impact";
const result = {
  input: "/a.png",
  inSize: 1000,
  outSize: 400,
  environmentComparable: true,
  outputCount: 1,
};
describe("desktop environmental result evidence", () => {
  it("requires native comparability and exact single-output evidence", () => {
    expect(captureDesktopImpact(result, "/a.png")?.comparable).toBe(true);
    for (const change of [
      { environmentComparable: undefined },
      { environmentComparable: false },
      { outputCount: undefined },
      { outputCount: 2 },
      { skippedOutputCount: 1 },
    ]) {
      expect(captureDesktopImpact({ ...result, ...change }, "/a.png")?.comparable).toBe(false);
    }
  });
  it("rejects misrouted, zero and unsafe native size reports", () => {
    expect(captureDesktopImpact(result, "/other.png")).toBeUndefined();
    for (const outSize of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(captureDesktopImpact({ ...result, outSize }, "/a.png")).toBeUndefined();
  });
  it("deducts larger results and excludes incomplete or incomparable jobs", () => {
    const impact = captureDesktopImpact(result, "/a.png")!;
    const larger = captureDesktopImpact({ ...result, outSize: 2000 }, "/a.png")!;
    const summary = summarizeDesktopImpact([
      { status: "done", impact },
      { status: "done", impact: larger },
      { status: "running", impact },
      { status: "done", impact: { ...impact, comparable: false } },
    ]);
    expect(summary).toMatchObject({
      count: 2,
      excluded: 1,
      measurement: { byteDifference: -400, savedBytes: 0 },
    });
    expect(summarizeDesktopImpact([])).toBeUndefined();
  });
});
