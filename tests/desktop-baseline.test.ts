// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  descendants,
  diffMs,
  outputPaths,
  parseProbeLine,
  percentile,
  samplesInWindow,
  summarize,
  validateRun,
} from "../scripts/lib/desktop-baseline.mjs";

describe("parseProbeLine", () => {
  it("accepts any JSON serialization of a mark", () => {
    const compact = parseProbeLine('{"imgconvert_perf":1,"mark":"ready","unix_ms":5,"value":2}');
    const spaced = parseProbeLine('  { "mark": "ready", "unix_ms": 5, "imgconvert_perf": 1 } ');
    expect(compact).toEqual({ mark: "ready", unixMs: 5, elapsedMs: null, value: 2 });
    expect(spaced).toEqual({ mark: "ready", unixMs: 5, elapsedMs: null, value: null });
  });

  it("rejects non-probe lines and malformed marks", () => {
    expect(parseProbeLine("plain log line")).toBeNull();
    expect(parseProbeLine('{"imgconvert_perf":2,"mark":"ready","unix_ms":5}')).toBeNull();
    expect(parseProbeLine('{"imgconvert_perf":1,"mark":"bad name","unix_ms":5}')).toBeNull();
    expect(parseProbeLine('{"imgconvert_perf":1,"mark":"ready"}')).toBeNull();
    expect(parseProbeLine('{"imgconvert_perf":1,"mark":"ready","unix_ms":"5"}')).toBeNull();
    expect(parseProbeLine("{not json")).toBeNull();
  });
});

describe("descendants", () => {
  it("collects the whole tree below the root", () => {
    const processes = new Map([
      [1, { pid: 1, ppid: 0 }],
      [10, { pid: 10, ppid: 1 }],
      [11, { pid: 11, ppid: 10 }],
      [12, { pid: 12, ppid: 11 }],
      [20, { pid: 20, ppid: 1 }],
    ]);
    expect([...descendants(processes, 10)].sort()).toEqual([10, 11, 12]);
    expect([...descendants(processes, 99)]).toEqual([99]);
  });
});

describe("statistics", () => {
  it("summarizes finite values only and reports n", () => {
    expect(summarize([3, null, 1, Number.NaN, 2])).toEqual({
      n: 3,
      median: 2,
      p95: 3,
      min: 1,
      max: 3,
    });
    expect(summarize([null, undefined])).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it("selects samples inside a closed window", () => {
    const samples = [{ t: 1 }, { t: 5 }, { t: 10 }, { t: 11 }];
    expect(samplesInWindow(samples, 5, 10)).toEqual([{ t: 5 }, { t: 10 }]);
  });

  it("computes mark differences", () => {
    const marks = new Map([
      ["a", { unixMs: 100 }],
      ["b", { unixMs: 250 }],
    ]);
    expect(diffMs(marks, "a", "b")).toBe(150);
    expect(diffMs(marks, "a", "missing")).toBeNull();
  });
});

describe("validateRun", () => {
  const marks = (names: string[]) => new Map(names.map((name) => [name, { unixMs: 0 }]));
  const baseRun = {
    exitedEarly: false,
    idleSamples: 5,
    samplesFailed: 0,
    rootMissing: 0,
    samplesMissingMemory: 0,
    purgeApplied: true,
    idleRssBytes: 100,
    idleAltBytes: 80,
    importCount: 200,
    scrollDistancePx: 1000,
    scrollIntervals: 120,
    scrollRefreshIntervalMs: 8.3,
    scrollIntervalP50Ms: 8.4,
    scrollIntervalP95Ms: 12,
    scrollIntervalP99Ms: 20,
    scrollIntervalMaxMs: 25,
    scrollLongIntervals: 0,
    batchCount: 200,
    batchDoneCount: 200,
    batchSamples: 10,
  };
  const importMarks = [
    "main_start",
    "rust_run",
    "ready",
    "import_start",
    "import_done",
    "probe_quiescent",
    "scroll_refresh_interval_ms",
    "scroll_intervals",
    "scroll_interval_p50_ms",
    "scroll_interval_p95_ms",
    "scroll_interval_p99_ms",
    "scroll_interval_max_ms",
    "scroll_long_intervals",
    "scroll_distance_px",
    "probe_done",
  ];
  const batchMarks = [
    "main_start",
    "rust_run",
    "ready",
    "import_start",
    "import_done",
    "probe_done",
    "batch_start",
    "batch_done",
  ];

  it("accepts a complete startup run", () => {
    expect(validateRun("startup", baseRun, marks(["main_start", "rust_run", "ready"]))).toEqual([]);
  });

  it("fails when an error mark is present even if probe_done arrived", () => {
    const reasons = validateRun(
      "startup",
      baseRun,
      marks(["main_start", "rust_run", "ready", "probe_error_scroll_range", "probe_done"]),
    );
    expect(reasons).toContain("error mark probe_error_scroll_range");
  });

  it("fails on missing marks, early exit, and too few idle samples", () => {
    const reasons = validateRun(
      "startup",
      { ...baseRun, exitedEarly: true, idleSamples: 1 },
      marks(["main_start"]),
    );
    expect(reasons).toContain("missing mark ready");
    expect(reasons).toContain("application exited before the scenario finished");
    expect(reasons.some((reason) => reason.includes("idle samples"))).toBe(true);
  });

  it("fails an import run that imported fewer files than the corpus", () => {
    const reasons = validateRun("import", { ...baseRun, importCount: 150 }, marks(importMarks), {
      corpusCount: 200,
    });
    expect(reasons).toEqual(["imported 150 of 200 corpus files"]);
  });

  it("fails an import run whose marks exist but carry no numbers", () => {
    const reasons = validateRun(
      "import",
      { ...baseRun, importCount: null, scrollDistancePx: null, scrollIntervals: null },
      marks(importMarks),
      { corpusCount: 200 },
    );
    expect(reasons).toEqual([
      "import count is missing",
      "scroll distance is missing or zero",
      "scroll interval count is missing or zero",
    ]);
    expect(
      validateRun("import", { ...baseRun, scrollIntervalP99Ms: null }, marks(importMarks), {
        corpusCount: 200,
      }),
    ).toEqual(["scrollIntervalP99Ms is missing"]);
  });

  it("requires the batch to cover the whole corpus", () => {
    expect(
      validateRun(
        "manual-batch",
        { ...baseRun, batchCount: 50, batchDoneCount: 50 },
        marks(batchMarks),
        {
          corpusCount: 200,
        },
      ),
    ).toEqual(["batch covered 50 of 200 corpus files"]);
  });

  it("requires PSS when the platform provides it", () => {
    expect(
      validateRun(
        "startup",
        { ...baseRun, idleAltBytes: null },
        marks(["main_start", "rust_run", "ready"]),
        {
          requireAlt: true,
        },
      ),
    ).toEqual(["idle PSS is missing on a platform that requires it"]);
    expect(
      validateRun(
        "startup",
        { ...baseRun, idleAltBytes: null },
        marks(["main_start", "rust_run", "ready"]),
        {
          requireAlt: false,
        },
      ),
    ).toEqual([]);
  });

  it("fails sampler faults and incomplete batches", () => {
    expect(
      validateRun(
        "startup",
        { ...baseRun, samplesFailed: 2, rootMissing: 1 },
        marks(["main_start", "rust_run", "ready"]),
      ),
    ).toEqual(["2 memory samples failed", "1 samples did not find the application process"]);
    expect(
      validateRun(
        "manual-batch",
        { ...baseRun, batchDoneCount: 1, batchSamples: 0 },
        marks(batchMarks),
        {
          corpusCount: 200,
        },
      ),
    ).toEqual(["batch completed 1 of 200 jobs", "no memory samples inside the batch window"]);
    expect(validateRun("manual-batch", baseRun, marks(batchMarks), { corpusCount: 200 })).toEqual(
      [],
    );
  });

  it("fails when a requested purge did not apply", () => {
    const reasons = validateRun(
      "startup",
      { ...baseRun, purgeApplied: false },
      marks(["main_start", "rust_run", "ready"]),
      { purge: true },
    );
    expect(reasons).toEqual(["page cache purge was requested but failed"]);
  });
});

describe("outputPaths", () => {
  it("never lets the markdown path collide with the json path", () => {
    expect(outputPaths("/tmp/baseline", "/x/default.json")).toEqual({
      json: "/tmp/baseline.json",
      markdown: "/tmp/baseline.md",
    });
    expect(outputPaths("/tmp/baseline.JSON", "/x/default.json")).toEqual({
      json: "/tmp/baseline.JSON",
      markdown: "/tmp/baseline.md",
    });
    expect(outputPaths(undefined, "/x/default.json")).toEqual({
      json: "/x/default.json",
      markdown: "/x/default.md",
    });
  });
});
