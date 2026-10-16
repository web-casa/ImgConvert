// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { percentile, summarizeIntervals, withFrameWatchdog } from "../src/lib/perf-probe";

describe("percentile", () => {
  it("uses nearest-rank on an ascending array", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.95)).toBe(10);
    expect(percentile(sorted, 0.99)).toBe(10);
    expect(percentile(sorted, 0.1)).toBe(1);
  });

  it("returns zero for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("summarizeIntervals", () => {
  it("reports interval count, percentiles, max and long intervals", () => {
    const stats = summarizeIntervals([16, 17, 16, 50, 16, 34, 16, 16, 16, 16]);
    expect(stats.intervals).toBe(10);
    expect(stats.p50Ms).toBe(16);
    expect(stats.p95Ms).toBe(50);
    expect(stats.p99Ms).toBe(50);
    expect(stats.maxMs).toBe(50);
    expect(stats.longIntervals).toBe(2);
  });

  it("does not mutate its input", () => {
    const intervals = [30, 10, 20];
    summarizeIntervals(intervals);
    expect(intervals).toEqual([30, 10, 20]);
  });

  it("returns zeros when no intervals were recorded", () => {
    expect(summarizeIntervals([])).toEqual({
      intervals: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      longIntervals: 0,
    });
  });
});

describe("withFrameWatchdog", () => {
  it("returns the phase result and counts frames when it finishes in time", async () => {
    vi.useFakeTimers();
    try {
      const outcome = await withFrameWatchdog(async (onFrame) => {
        onFrame();
        onFrame();
        return 42;
      }, 1000);
      expect(outcome).toEqual({ result: 42 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a timeout with the frames seen when frames stop arriving", async () => {
    vi.useFakeTimers();
    try {
      const pending = withFrameWatchdog<number>((onFrame) => {
        onFrame();
        return new Promise(() => {});
      }, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ timedOut: true, frames: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates a phase failure instead of swallowing it", async () => {
    await expect(withFrameWatchdog(() => Promise.reject(new Error("boom")), 1000)).rejects.toThrow(
      "boom",
    );
  });
});
