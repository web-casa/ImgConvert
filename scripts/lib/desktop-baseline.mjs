// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors
//
// Pure helpers for scripts/measure-desktop-baseline.mjs, kept separate so they
// can be unit tested without launching an application.

/** Nearest-rank percentile. `values` may be unsorted. */
export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Summary statistics over finite numbers only. Returns null when nothing is finite. */
export function summarize(values) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (clean.length === 0) return null;
  return {
    n: clean.length,
    median: median(clean),
    p95: percentile(clean, 0.95),
    min: Math.min(...clean),
    max: Math.max(...clean),
  };
}

/**
 * Parses one stderr line into a probe mark, or null when the line is not a
 * well-formed mark. Accepts any JSON serialization (whitespace, key order).
 */
export function parseProbeLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || parsed.imgconvert_perf !== 1) return null;
  if (typeof parsed.mark !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(parsed.mark)) return null;
  if (typeof parsed.unix_ms !== "number" || !Number.isFinite(parsed.unix_ms)) return null;
  const elapsedMs =
    typeof parsed.elapsed_ms === "number" && Number.isFinite(parsed.elapsed_ms)
      ? parsed.elapsed_ms
      : null;
  const value =
    typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : null;
  return { mark: parsed.mark, unixMs: parsed.unix_ms, elapsedMs, value };
}

/** Set of pids reachable from `rootPid` through parent links, including the root. */
export function descendants(processes, rootPid) {
  const children = new Map();
  for (const proc of processes.values()) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc.pid);
  }
  const tree = new Set([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    for (const child of children.get(pid) ?? []) {
      if (!tree.has(child)) {
        tree.add(child);
        stack.push(child);
      }
    }
  }
  return tree;
}

/** Samples whose timestamp falls inside the closed window. */
export function samplesInWindow(samples, startMs, endMs) {
  return samples.filter((sample) => sample.t >= startMs && sample.t <= endMs);
}

export const ERROR_MARK_PREFIX = "probe_error";

export const REQUIRED_MARKS = {
  startup: ["main_start", "rust_run", "ready"],
  import: [
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
  ],
  "manual-batch": [
    "main_start",
    "rust_run",
    "ready",
    "import_start",
    "import_done",
    "probe_done",
    "batch_start",
    "batch_done",
  ],
};

export const MIN_IDLE_SAMPLES = 3;

/**
 * Returns a list of reasons a run must be rejected. Empty means the run is valid.
 * `run` is the result object built by the sampler; `marks` is the Map of marks.
 */
export function validateRun(scenario, run, marks, expectations = {}) {
  const reasons = [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  for (const mark of marks.keys()) {
    if (mark.startsWith(ERROR_MARK_PREFIX)) reasons.push(`error mark ${mark}`);
  }
  for (const required of REQUIRED_MARKS[scenario] ?? []) {
    if (!marks.has(required)) reasons.push(`missing mark ${required}`);
  }
  if (marks.has("import_failed")) reasons.push("import_failed observed");
  if (marks.has("batch_failed")) reasons.push("batch_failed observed");
  if (marks.has("batch_cancelled")) reasons.push("batch_cancelled observed");
  if (run.exitedEarly) reasons.push("application exited before the scenario finished");
  if (run.idleSamples < MIN_IDLE_SAMPLES) {
    reasons.push(`only ${run.idleSamples} idle samples (need ${MIN_IDLE_SAMPLES})`);
  }
  if (run.samplesFailed > 0) reasons.push(`${run.samplesFailed} memory samples failed`);
  if (run.rootMissing > 0) {
    reasons.push(`${run.rootMissing} samples did not find the application process`);
  }
  if (run.samplesMissingMemory > 0) {
    reasons.push(`${run.samplesMissingMemory} samples had processes without memory data`);
  }
  if (!finite(run.idleRssBytes)) reasons.push("idle RSS is missing");
  if (expectations.requireAlt && !finite(run.idleAltBytes)) {
    reasons.push("idle PSS is missing on a platform that requires it");
  }
  if (expectations.purge && !run.purgeApplied) {
    reasons.push("page cache purge was requested but failed");
  }
  if (scenario !== "startup") {
    if (!finite(run.importCount)) reasons.push("import count is missing");
    else if (
      typeof expectations.corpusCount === "number" &&
      run.importCount < expectations.corpusCount
    ) {
      reasons.push(`imported ${run.importCount} of ${expectations.corpusCount} corpus files`);
    }
  }
  if (scenario === "import") {
    for (const metric of [
      "scrollRefreshIntervalMs",
      "scrollIntervalP50Ms",
      "scrollIntervalP95Ms",
      "scrollIntervalP99Ms",
      "scrollIntervalMaxMs",
      "scrollLongIntervals",
    ]) {
      if (!finite(run[metric])) reasons.push(`${metric} is missing`);
    }
    if (!finite(run.scrollDistancePx) || run.scrollDistancePx <= 0) {
      reasons.push("scroll distance is missing or zero");
    }
    if (!finite(run.scrollIntervals) || run.scrollIntervals <= 0) {
      reasons.push("scroll interval count is missing or zero");
    }
  }
  if (scenario === "manual-batch") {
    if (!finite(run.batchCount) || run.batchCount <= 0) reasons.push("batch size is missing");
    else if (
      typeof expectations.corpusCount === "number" &&
      run.batchCount < expectations.corpusCount
    ) {
      reasons.push(`batch covered ${run.batchCount} of ${expectations.corpusCount} corpus files`);
    } else if (run.batchDoneCount !== run.batchCount) {
      reasons.push(`batch completed ${run.batchDoneCount ?? "?"} of ${run.batchCount} jobs`);
    }
    if (!(run.batchSamples > 0)) reasons.push("no memory samples inside the batch window");
  }
  return reasons;
}

/** Resolves the JSON and Markdown output paths from the `--out` option. */
export function outputPaths(outOption, defaultJsonPath) {
  let json = outOption ?? defaultJsonPath;
  if (!json.toLowerCase().endsWith(".json")) json = `${json}.json`;
  return { json, markdown: `${json.slice(0, -".json".length)}.md` };
}

/** Mark lookup helpers shared by the sampler. */
export function markUnix(marks, name) {
  return marks.get(name)?.unixMs ?? null;
}

export function markValue(marks, name) {
  return marks.get(name)?.value ?? null;
}

export function diffMs(marks, from, to) {
  const a = markUnix(marks, from);
  const b = markUnix(marks, to);
  return a === null || b === null ? null : b - a;
}
