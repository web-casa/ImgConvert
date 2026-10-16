// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors
//
// Desktop baseline sampler for the Tauri → GPUI migration (docs/GPUI_BASELINE.md).
//
// Launches the desktop binary with IMGCONVERT_PERF_PROBE=1, reads the JSON mark
// lines the app prints to stderr, and samples the memory of the whole process
// tree while the app runs. The same script measures the Tauri app today and the
// GPUI app later, as long as both implement the mark protocol.
//
//   node scripts/measure-desktop-baseline.mjs \
//     --app=/Applications/ImgConvert.app --label=tauri \
//     --corpus=/tmp/imgconvert-corpus-10k --runs=10
//
// Scenarios:
//   startup      launch, wait for `ready`, settle, sample idle memory (empty queue)
//   import       launch, import --corpus, wait for thumbnails to go quiet, scroll
//                the queue, settle, sample idle memory
//   manual-batch launch, import --corpus, then wait for the operator to start a
//                conversion in the app; records batch duration and sampled peak
//                memory between `batch_start` and `batch_done`

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import {
  ERROR_MARK_PREFIX,
  descendants,
  diffMs,
  markUnix,
  markValue,
  median,
  outputPaths,
  parseProbeLine,
  samplesInWindow,
  summarize,
  validateRun,
} from "./lib/desktop-baseline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROCESS_QUERY_TIMEOUT_MS = 3000;

const options = {
  app: undefined,
  label: undefined,
  corpus: undefined,
  runs: 10,
  settleSeconds: 5,
  scrollMs: 10_000,
  sampleMs: 250,
  scenarios: ["startup", "import"],
  out: undefined,
  purge: false,
  note: "",
  readyTimeoutMs: 60_000,
  importTimeoutMs: 15 * 60_000,
  batchTimeoutMs: 60 * 60_000,
};

for (const arg of process.argv.slice(2).filter((value) => value !== "--")) {
  if (arg.startsWith("--app=")) options.app = arg.slice("--app=".length);
  else if (arg.startsWith("--label=")) options.label = arg.slice("--label=".length);
  else if (arg.startsWith("--corpus=")) options.corpus = arg.slice("--corpus=".length);
  else if (arg.startsWith("--runs="))
    options.runs = Number.parseInt(arg.slice("--runs=".length), 10);
  else if (arg.startsWith("--settle="))
    options.settleSeconds = Number.parseFloat(arg.slice("--settle=".length));
  else if (arg.startsWith("--scroll-ms="))
    options.scrollMs = Number.parseInt(arg.slice("--scroll-ms=".length), 10);
  else if (arg.startsWith("--sample-ms="))
    options.sampleMs = Number.parseInt(arg.slice("--sample-ms=".length), 10);
  else if (arg.startsWith("--scenarios="))
    options.scenarios = arg
      .slice("--scenarios=".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  else if (arg.startsWith("--out=")) options.out = arg.slice("--out=".length);
  else if (arg.startsWith("--note=")) options.note = arg.slice("--note=".length);
  else if (arg.startsWith("--batch-timeout-min="))
    options.batchTimeoutMs = Number.parseInt(arg.slice("--batch-timeout-min=".length), 10) * 60_000;
  else if (arg === "--purge") options.purge = true;
  else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}

const KNOWN_SCENARIOS = new Set(["startup", "import", "manual-batch"]);
function usageError(message) {
  console.error(message);
  console.error(
    "usage: measure-desktop-baseline.mjs --app=<binary|.app> --label=<tauri|gpui> [--corpus=<dir>] [--runs=N] [--settle=S] [--scroll-ms=MS] [--sample-ms=MS] [--scenarios=startup,import,manual-batch] [--out=<file.json>] [--note=<text>] [--batch-timeout-min=M] [--purge]",
  );
  process.exit(2);
}
if (!options.app) usageError("--app is required");
if (!options.label || !/^[a-z0-9-]+$/i.test(options.label)) {
  usageError("--label is required and must match [a-z0-9-]+");
}
if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) {
  usageError("--runs must be an integer between 1 and 100");
}
if (!(options.settleSeconds >= 1 && options.settleSeconds <= 120)) {
  usageError("--settle must be between 1 and 120 seconds");
}
if (!Number.isInteger(options.scrollMs) || options.scrollMs < 1000 || options.scrollMs > 120_000) {
  usageError("--scroll-ms must be between 1000 and 120000");
}
if (!Number.isInteger(options.sampleMs) || options.sampleMs < 100 || options.sampleMs > 5000) {
  usageError("--sample-ms must be between 100 and 5000");
}
if (!Number.isInteger(options.batchTimeoutMs) || options.batchTimeoutMs < 60_000) {
  usageError("--batch-timeout-min must be a positive integer");
}
for (const scenario of options.scenarios) {
  if (!KNOWN_SCENARIOS.has(scenario)) usageError(`unknown scenario: ${scenario}`);
}
const needsCorpus = options.scenarios.some((scenario) => scenario !== "startup");
if (needsCorpus) {
  if (!options.corpus) usageError("--corpus is required for the import and manual-batch scenarios");
  if (!existsSync(options.corpus) || !statSync(options.corpus).isDirectory()) {
    usageError(`--corpus is not a directory: ${options.corpus}`);
  }
}
if (process.platform === "win32" && options.sampleMs < 1000) {
  // Enumerating processes through PowerShell is slow; avoid distorting the run.
  options.sampleMs = 1000;
}
if (options.purge && process.platform === "win32") {
  usageError("--purge is not supported on Windows");
}

const executable = resolveExecutable(options.app);
const corpusDir = options.corpus ? path.resolve(options.corpus) : null;
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|avif|bmp|gif|svg)$/i;
function countImageFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countImageFiles(path.join(dir, entry.name));
    else if (entry.isFile() && IMAGE_FILE_PATTERN.test(entry.name)) count += 1;
  }
  return count;
}
const corpusCount = corpusDir ? countImageFiles(corpusDir) : 0;

function resolveExecutable(appPath) {
  const resolved = path.resolve(appPath);
  if (!existsSync(resolved)) usageError(`--app does not exist: ${resolved}`);
  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    if (process.platform !== "darwin" || !resolved.endsWith(".app")) {
      usageError("--app must be an executable file, or a .app bundle on macOS");
    }
    const macosDir = path.join(resolved, "Contents", "MacOS");
    const plist = path.join(resolved, "Contents", "Info.plist");
    let executableName;
    if (existsSync(plist)) {
      const read = spawnSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :CFBundleExecutable", plist],
        {
          encoding: "utf8",
          timeout: PROCESS_QUERY_TIMEOUT_MS,
        },
      );
      if (read.status === 0) executableName = read.stdout.trim();
    }
    if (!executableName) {
      const candidates = readdirSync(macosDir);
      if (candidates.length !== 1) usageError(`cannot determine executable in ${macosDir}`);
      executableName = candidates[0];
    }
    return path.join(macosDir, executableName);
  }
  return resolved;
}

function sha256File(filePath) {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function repoIdentity() {
  const run = (args) =>
    spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", timeout: PROCESS_QUERY_TIMEOUT_MS });
  const head = run(["rev-parse", "HEAD"]);
  const status = run(["status", "--porcelain"]);
  return {
    commit: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
  };
}

// ---- process enumeration ----
// Each entry: { pid, ppid, comm, rssBytes: number|null, altBytes: number|null }.
// `altBytes` is PSS on Linux and the raw Win32 PrivatePageCount on Windows
// (its unit is not verified; it is reported, not converted). macOS has none.

const ALT_KIND = { linux: "pss", win32: "win32_private_page_count_raw", darwin: null }[
  process.platform
];

function listProcesses() {
  if (process.platform === "linux") return listProcessesLinux();
  if (process.platform === "darwin") return listProcessesDarwin();
  if (process.platform === "win32") return listProcessesWindows();
  throw new Error(`unsupported platform: ${process.platform}`);
}

function listProcessesLinux() {
  const processes = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number.parseInt(entry, 10);
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      continue; // process vanished; topology cannot be read at all
    }
    const close = stat.lastIndexOf(")");
    const comm = stat.slice(stat.indexOf("(") + 1, close);
    const fields = stat.slice(close + 2).split(" ");
    const ppid = Number.parseInt(fields[1], 10);
    let rssBytes = null;
    let altBytes = null;
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const match = /VmRSS:\s+(\d+) kB/.exec(status);
      if (match) rssBytes = Number.parseInt(match[1], 10) * 1024;
    } catch {
      rssBytes = null;
    }
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      const match = /^Pss:\s+(\d+) kB/m.exec(rollup);
      if (match) altBytes = Number.parseInt(match[1], 10) * 1024;
    } catch {
      altBytes = null;
    }
    processes.set(pid, { pid, ppid, comm, rssBytes, altBytes });
  }
  return processes;
}

function listProcessesDarwin() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,comm="], {
    encoding: "utf8",
    timeout: PROCESS_QUERY_TIMEOUT_MS,
  });
  if (result.status !== 0) throw new Error(`ps failed: ${result.stderr || result.error}`);
  const processes = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    processes.set(pid, {
      pid,
      ppid: Number.parseInt(match[2], 10),
      comm: match[4],
      rssBytes: Number.parseInt(match[3], 10) * 1024,
      altBytes: null,
    });
  }
  return processes;
}

function listProcessesWindows() {
  const script =
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.WorkingSetSize)|$($_.PrivatePageCount)|$($_.Name)" }';
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: PROCESS_QUERY_TIMEOUT_MS * 4,
  });
  if (result.status !== 0) throw new Error(`powershell failed: ${result.stderr || result.error}`);
  const finite = (text) => {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) ? value : null;
  };
  const processes = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split("|");
    if (parts.length < 5) continue;
    const pid = finite(parts[0]);
    const ppid = finite(parts[1]);
    if (pid === null || ppid === null) continue;
    processes.set(pid, {
      pid,
      ppid,
      comm: parts.slice(4).join("|"),
      rssBytes: finite(parts[2]),
      altBytes: finite(parts[3]),
    });
  }
  return processes;
}

/** macOS WebKit XPC helpers are launched by launchd, not as children of the app. */
function isWebKitHelper(comm) {
  return path.basename(comm).startsWith("com.apple.WebKit.");
}

function helperPidsDarwin(processes) {
  const pids = new Set();
  for (const proc of processes.values()) if (isWebKitHelper(proc.comm)) pids.add(proc.pid);
  return pids;
}

/**
 * One memory sample of the app's process tree. On macOS, WebKit helpers that
 * appeared after launch are attributed to the app; the attributed pids are
 * recorded so a run can be audited. Do not run another WKWebView application
 * during a measurement.
 */
function sampleMemory(rootPid, preexistingHelpers) {
  const startedAt = Date.now();
  const processes = listProcesses();
  const tree = descendants(processes, rootPid);
  const attributedHelpers = [];
  if (process.platform === "darwin") {
    for (const pid of helperPidsDarwin(processes)) {
      if (!preexistingHelpers.has(pid) && !tree.has(pid)) {
        tree.add(pid);
        attributedHelpers.push(pid);
      }
    }
  }
  let rssBytes = 0;
  let altBytes = 0;
  let altComplete = ALT_KIND !== null;
  let missingMemory = 0;
  let count = 0;
  for (const pid of tree) {
    const proc = processes.get(pid);
    if (!proc) continue;
    count += 1;
    if (proc.rssBytes === null) missingMemory += 1;
    else rssBytes += proc.rssBytes;
    if (proc.altBytes === null) altComplete = false;
    else altBytes += proc.altBytes;
  }
  return {
    t: startedAt,
    queryMs: Date.now() - startedAt,
    rssBytes,
    altBytes: altComplete ? altBytes : null,
    processes: count,
    pids: [...tree],
    attributedHelpers,
    missingMemory,
    rootPresent: processes.has(rootPid),
  };
}

// ---- process lifecycle ----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Terminates the root and every pid observed in its tree, then waits. */
async function terminateTree(child, knownPids) {
  const pids = new Set([child.pid, ...knownPids]);
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
      stdio: "ignore",
      timeout: PROCESS_QUERY_TIMEOUT_MS * 2,
    });
  } else {
    killPid(child.pid, "SIGTERM");
  }
  let deadline = Date.now() + 5000;
  while (Date.now() < deadline && pidAlive(child.pid)) await sleep(50);
  for (const pid of pids) if (pidAlive(pid)) killPid(pid, "SIGKILL");
  deadline = Date.now() + 3000;
  while (Date.now() < deadline && [...pids].some(pidAlive)) await sleep(50);
  return [...pids].filter(pidAlive);
}

let currentChild = null;
let currentPids = new Set();
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    console.error(`\nreceived ${signal}; terminating the application`);
    if (currentChild) {
      void terminateTree(currentChild, currentPids).then(() => process.exit(130));
    } else {
      process.exit(130);
    }
  });
}

function purgeCaches() {
  if (!options.purge) return { requested: false, applied: false, method: null };
  if (process.platform === "darwin") {
    const result = spawnSync("sudo", ["-n", "purge"], { stdio: "inherit", timeout: 60_000 });
    return { requested: true, applied: result.status === 0, method: "sudo purge" };
  }
  if (process.platform === "linux") {
    const result = spawnSync(
      "sudo",
      ["-n", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"],
      {
        stdio: "inherit",
        timeout: 60_000,
      },
    );
    return { requested: true, applied: result.status === 0, method: "drop_caches" };
  }
  return { requested: true, applied: false, method: null };
}

// ---- one run ----

async function runOnce(scenario, runIndex) {
  const purge = purgeCaches();
  if (purge.requested && !purge.applied) {
    console.error(
      "warning: page cache purge failed; run `sudo -v` first. This run will be invalid.",
    );
  }
  const env = { ...process.env };
  // Never inherit scenario variables from the operator's shell.
  for (const key of Object.keys(env)) if (key.startsWith("IMGCONVERT_PERF_PROBE")) delete env[key];
  env.IMGCONVERT_PERF_PROBE = "1";
  if (scenario !== "startup") env.IMGCONVERT_PERF_PROBE_IMPORT = corpusDir;
  if (scenario === "import") {
    env.IMGCONVERT_PERF_PROBE_SCROLL = "1";
    env.IMGCONVERT_PERF_PROBE_SCROLL_MS = String(options.scrollMs);
  }

  const preexistingHelpers =
    process.platform === "darwin" ? helperPidsDarwin(listProcessesDarwin()) : new Set();
  const spawnAt = Date.now();
  let child;
  try {
    child = spawn(executable, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    return { scenario, run: runIndex, ok: false, reasons: [`spawn failed: ${error.message}`] };
  }
  currentChild = child;
  currentPids = new Set([child.pid]);

  const marks = new Map();
  const events = [];
  const samples = [];
  const stderrTail = [];
  let exited = false;
  let exitCode = null;
  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error;
    exited = true;
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const lines = readline.createInterface({ input: child.stderr });
  lines.on("line", (line) => {
    if (stderrTail.push(line) > 50) stderrTail.shift();
    const mark = parseProbeLine(line);
    if (!mark) return;
    events.push(mark);
    if (!marks.has(mark.mark)) marks.set(mark.mark, mark);
  });

  let sampling = false;
  const sampler = setInterval(() => {
    if (exited || sampling) return;
    sampling = true;
    try {
      const sample = sampleMemory(child.pid, preexistingHelpers);
      samples.push(sample);
      for (const pid of sample.pids) currentPids.add(pid);
    } catch (error) {
      samples.push({ t: Date.now(), error: error.message });
    } finally {
      sampling = false;
    }
  }, options.sampleMs);

  const errorMark = () => [...marks.keys()].find((name) => name.startsWith(ERROR_MARK_PREFIX));

  /** Waits for one of `names`; error marks and exits take priority. */
  const waitForMark = async (names, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const error = errorMark();
      if (error) return { status: "error", mark: error };
      if (spawnError) return { status: "exited", reason: spawnError.message };
      if (exited) return { status: "exited", reason: `exit code ${exitCode}` };
      for (const name of names) if (marks.has(name)) return { status: "ok", mark: name };
      if (interrupted) return { status: "exited", reason: "interrupted" };
      await sleep(50);
    }
    return { status: "timeout" };
  };

  const reasons = [];
  let exitedEarly = false;
  let idleStart = null;
  let idleEnd = null;

  const settle = async () => {
    idleStart = Date.now();
    const deadline = idleStart + options.settleSeconds * 1000;
    while (Date.now() < deadline) {
      if (exited) {
        exitedEarly = true;
        reasons.push("application exited during the settle window");
        break;
      }
      await sleep(50);
    }
    idleEnd = Date.now();
  };

  try {
    const ready = await waitForMark(["ready"], options.readyTimeoutMs);
    if (ready.status !== "ok") {
      reasons.push(describeWait("ready", ready));
      exitedEarly = ready.status === "exited";
    } else if (scenario === "startup") {
      await settle();
    } else {
      const done = await waitForMark(["probe_done"], options.importTimeoutMs);
      if (done.status !== "ok") {
        reasons.push(describeWait("probe_done", done));
        exitedEarly = done.status === "exited";
      } else {
        if (scenario === "manual-batch") {
          console.error(
            `\n[run ${runIndex + 1}] Queue is loaded (${markValue(marks, "probe_done") ?? "?"} items). ` +
              "In the app: choose an output directory and click Start. " +
              `Waiting up to ${Math.round(options.batchTimeoutMs / 60_000)} min for the batch to finish.`,
          );
          const started = await waitForMark(["batch_start"], options.batchTimeoutMs);
          if (started.status !== "ok") {
            reasons.push(describeWait("batch_start", started));
            exitedEarly = started.status === "exited";
          } else {
            const finished = await waitForMark(
              ["batch_done", "batch_failed", "batch_cancelled"],
              options.batchTimeoutMs,
            );
            if (finished.status !== "ok") {
              reasons.push(describeWait("batch outcome", finished));
              exitedEarly = finished.status === "exited";
            } else if (finished.mark !== "batch_done") {
              reasons.push(`batch ended with ${finished.mark}`);
            }
          }
        }
        if (reasons.length === 0) await settle();
      }
    }
  } finally {
    clearInterval(sampler);
    lines.close();
    const leftovers = await terminateTree(child, currentPids);
    if (leftovers.length > 0)
      reasons.push(`processes still alive after kill: ${leftovers.join(",")}`);
    currentChild = null;
    currentPids = new Set();
  }

  const goodSamples = samples.filter((sample) => !sample.error);
  const idleSamples = idleStart === null ? [] : samplesInWindow(goodSamples, idleStart, idleEnd);
  const rssOf = (list) => list.map((sample) => sample.rssBytes);
  const altOf = (list) =>
    list.every((sample) => sample.altBytes !== null) ? list.map((sample) => sample.altBytes) : null;
  const peak = (list) => (list.length ? Math.max(...rssOf(list)) : null);
  const peakAlt = (list) => {
    const values = altOf(list);
    return values && values.length ? Math.max(...values) : null;
  };
  const intervals = [];
  for (let index = 1; index < goodSamples.length; index += 1) {
    intervals.push(goodSamples[index].t - goodSamples[index - 1].t);
  }

  const result = {
    scenario,
    run: runIndex,
    ok: false,
    reasons,
    exitCode,
    exitedEarly,
    purgeRequested: purge.requested,
    purgeApplied: purge.applied,
    purgeMethod: purge.method,
    readyMs: markUnix(marks, "ready") !== null ? markUnix(marks, "ready") - spawnAt : null,
    readyElapsedMs: marks.get("ready")?.elapsedMs ?? null,
    rustRunMs: markUnix(marks, "rust_run") !== null ? markUnix(marks, "rust_run") - spawnAt : null,
    mainStartMs:
      markUnix(marks, "main_start") !== null ? markUnix(marks, "main_start") - spawnAt : null,
    idleWindowMs: idleStart === null ? null : idleEnd - idleStart,
    idleSamples: idleSamples.length,
    idleRssBytes: median(rssOf(idleSamples)),
    idleAltBytes: altOf(idleSamples) ? median(altOf(idleSamples)) : null,
    idleProcesses: median(idleSamples.map((sample) => sample.processes)),
    peakRssBytes: peak(goodSamples),
    peakAltBytes: peakAlt(goodSamples),
    altKind: ALT_KIND,
    sampleCount: goodSamples.length,
    memorySamples: samples,
    samplesFailed: samples.length - goodSamples.length,
    samplesMissingMemory: goodSamples.filter((sample) => sample.missingMemory > 0).length,
    rootMissing: goodSamples.filter((sample) => !sample.rootPresent).length,
    samplerIntervalMs: median(intervals),
    samplerQueryMs: median(goodSamples.map((sample) => sample.queryMs)),
    attributedHelperPids: [...new Set(goodSamples.flatMap((sample) => sample.attributedHelpers))],
    importCount: null,
    importMs: null,
    scrollDistancePx: null,
    events,
    stderrTail,
  };
  if (scenario !== "startup") {
    result.importCount = markValue(marks, "import_done");
    result.importMs = diffMs(marks, "import_start", "import_done");
    result.quiescenceMs = diffMs(marks, "import_done", "probe_quiescent");
    result.queueLength = markValue(marks, "probe_done");
  }
  if (scenario === "import") {
    result.scrollRefreshIntervalMs = markValue(marks, "scroll_refresh_interval_ms");
    result.scrollIntervals = markValue(marks, "scroll_intervals");
    result.scrollIntervalP50Ms = markValue(marks, "scroll_interval_p50_ms");
    result.scrollIntervalP95Ms = markValue(marks, "scroll_interval_p95_ms");
    result.scrollIntervalP99Ms = markValue(marks, "scroll_interval_p99_ms");
    result.scrollIntervalMaxMs = markValue(marks, "scroll_interval_max_ms");
    result.scrollLongIntervals = markValue(marks, "scroll_long_intervals");
    result.scrollDistancePx = markValue(marks, "scroll_distance_px");
    result.scrollPxPerSecond = markValue(marks, "scroll_px_per_s");
  }
  if (scenario === "manual-batch") {
    // A failed or cancelled batch is invalid, but its done count, duration and
    // peak memory are still recorded so the failure can be diagnosed.
    const outcomeMark =
      ["batch_done", "batch_failed", "batch_cancelled"].find((name) => marks.has(name)) ?? null;
    result.batchCount = markValue(marks, "batch_start");
    result.batchOutcome = outcomeMark;
    result.batchDoneCount = outcomeMark === null ? null : markValue(marks, outcomeMark);
    result.batchMs = outcomeMark === null ? null : diffMs(marks, "batch_start", outcomeMark);
    const batchSamples =
      markUnix(marks, "batch_start") !== null &&
      outcomeMark !== null &&
      markUnix(marks, outcomeMark) !== null
        ? samplesInWindow(goodSamples, markUnix(marks, "batch_start"), markUnix(marks, outcomeMark))
        : [];
    result.batchSamples = batchSamples.length;
    result.batchPeakRssBytes = peak(batchSamples);
    result.batchPeakAltBytes = peakAlt(batchSamples);
  }
  result.reasons.push(
    ...validateRun(scenario, result, marks, {
      purge: options.purge,
      corpusCount,
      requireAlt: ALT_KIND === "pss",
    }),
  );
  result.ok = result.reasons.length === 0;
  return result;
}

function describeWait(what, outcome) {
  if (outcome.status === "error") return `${outcome.mark} while waiting for ${what}`;
  if (outcome.status === "exited")
    return `application exited while waiting for ${what} (${outcome.reason})`;
  return `timeout waiting for ${what}`;
}

// ---- main ----

const METRICS = {
  startup: [
    "readyMs",
    "readyElapsedMs",
    "idleRssBytes",
    "idleAltBytes",
    "peakRssBytes",
    "idleProcesses",
  ],
  import: [
    "readyMs",
    "importMs",
    "quiescenceMs",
    "scrollRefreshIntervalMs",
    "scrollIntervalP50Ms",
    "scrollIntervalP95Ms",
    "scrollIntervalP99Ms",
    "scrollIntervalMaxMs",
    "scrollLongIntervals",
    "scrollPxPerSecond",
    "idleRssBytes",
    "idleAltBytes",
    "peakRssBytes",
  ],
  "manual-batch": [
    "batchMs",
    "batchPeakRssBytes",
    "batchPeakAltBytes",
    "batchDoneCount",
    "batchSamples",
  ],
};

function formatMetric(name, value) {
  if (value === null || value === undefined) return "n/a";
  if (name.endsWith("Bytes")) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (name.endsWith("Ms")) return `${value.toFixed(1)} ms`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const report = {
  label: options.label,
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  hostname: os.hostname(),
  cpu: os.cpus()[0]?.model || "unknown",
  cpus: os.cpus().length,
  totalMemBytes: os.totalmem(),
  node: process.version,
  executable,
  executableSha256: sha256File(executable),
  repo: repoIdentity(),
  corpus: corpusDir,
  corpusCount,
  altKind: ALT_KIND,
  note: options.note,
  timestamp: new Date().toISOString(),
  options: { ...options },
  scenarios: {},
};

console.error(
  `measuring ${options.label} on ${process.platform}/${process.arch}: ${executable} (${options.runs} runs × ${options.scenarios.join(", ")})`,
);

for (const scenario of options.scenarios) {
  const runs = [];
  for (let index = 0; index < options.runs && !interrupted; index += 1) {
    console.error(`[${scenario}] run ${index + 1}/${options.runs}`);
    const result = await runOnce(scenario, index);
    runs.push(result);
    if (!result.ok) {
      console.error(`[${scenario}] run ${index + 1} invalid: ${result.reasons.join("; ")}`);
      for (const line of (result.stderrTail ?? []).slice(-10)) console.error(`  | ${line}`);
    }
    await sleep(3000);
  }
  const okRuns = runs.filter((run) => run.ok);
  const summary = {};
  for (const metric of METRICS[scenario]) {
    summary[metric] = summarize(okRuns.map((run) => run[metric]));
  }
  report.scenarios[scenario] = { runs, okRuns: okRuns.length, summary };
}

const defaultJson = path.join(
  repoRoot,
  "artifacts",
  "baseline",
  `${options.label}-${process.platform}-${process.arch}-${report.timestamp.replace(/[:.]/g, "-")}.json`,
);
const paths = outputPaths(options.out ? path.resolve(options.out) : undefined, defaultJson);
mkdirSync(path.dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  `# Desktop baseline: ${options.label} (${process.platform}/${process.arch})`,
  "",
  `- executable: \`${executable}\` (sha256 ${report.executableSha256 ?? "n/a"})`,
  `- repo: ${report.repo.commit ?? "n/a"}${report.repo.dirty ? " (dirty)" : ""}`,
  `- corpus: ${corpusDir ? `\`${corpusDir}\` (${corpusCount} image files)` : "none"}`,
  `- runs: ${options.runs}, settle: ${options.settleSeconds}s, scroll: ${options.scrollMs}ms, sample: ${options.sampleMs}ms, purge: ${options.purge}`,
  `- machine: ${report.cpu} × ${report.cpus}, ${(report.totalMemBytes / 2 ** 30).toFixed(0)} GiB, ${report.release}`,
  `- memory columns: RSS is the process-tree sum of resident pages (shared pages counted once per process); alt = ${ALT_KIND ?? "none"}`,
  options.note ? `- note: ${options.note}` : null,
  "",
].filter((line) => line !== null);
for (const [scenario, data] of Object.entries(report.scenarios)) {
  lines.push(`## ${scenario} (${data.okRuns}/${data.runs.length} runs valid)`, "");
  lines.push("| metric | n | median | p95 | min | max |", "|---|---|---|---|---|---|");
  for (const [metric, stats] of Object.entries(data.summary)) {
    if (!stats) {
      lines.push(`| ${metric} | 0 | n/a | n/a | n/a | n/a |`);
      continue;
    }
    lines.push(
      `| ${metric} | ${stats.n} | ${formatMetric(metric, stats.median)} | ${formatMetric(metric, stats.p95)} | ${formatMetric(metric, stats.min)} | ${formatMetric(metric, stats.max)} |`,
    );
  }
  const invalid = data.runs.filter((run) => !run.ok);
  if (invalid.length > 0) {
    lines.push("", "Invalid runs:", "");
    for (const run of invalid) lines.push(`- run ${run.run + 1}: ${run.reasons.join("; ")}`);
  }
  lines.push("");
}
const markdown = lines.join("\n");
writeFileSync(paths.markdown, `${markdown}\n`);
console.log(markdown);
console.error(`wrote ${paths.json}`);

const failed = Object.values(report.scenarios).some((data) => data.okRuns < data.runs.length);
process.exit(failed || interrupted ? 1 : 0);
