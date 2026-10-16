// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

// Desktop performance probe. Inert unless the Rust side reports that
// `IMGCONVERT_PERF_PROBE=1` is set. See `docs/GPUI_BASELINE.md` for the line
// protocol shared with `scripts/measure-desktop-baseline.mjs`.

import { invoke, isTauri } from "@tauri-apps/api/core";

interface PerfProbeConfig {
  importPath: string | null;
  scroll: boolean;
  scrollDurationMs: number;
}

interface PerfProbeHooks {
  importPaths: (paths: string[]) => Promise<void>;
  queueLength: () => number;
  isImporting: () => boolean;
  /** Number of queue items whose thumbnail is currently being generated. */
  pendingThumbnails: () => number;
}

export interface ScrollIntervalStats {
  intervals: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  longIntervals: number;
}

const IMPORT_TIMEOUT_MS = 10 * 60_000;
const QUIESCENCE_TIMEOUT_MS = 5 * 60_000;
const REFRESH_SAMPLE_MS = 1000;
/** Extra time a frame-driven phase may take beyond its nominal duration. */
const FRAME_WATCHDOG_GRACE_MS = 60_000;
const LONG_INTERVAL_MS = 33;
const SCROLL_CONTAINER_SELECTOR = '[data-testid="workspace-scroll"]';

let probeEnabled = false;

/** Fire-and-forget mark. Never throws; silently ignored when the probe is off. */
export function perfMark(name: string, value?: number): void {
  if (!probeEnabled) return;
  const payload: { name: string; value?: number } = { name };
  if (typeof value === "number" && Number.isFinite(value)) payload.value = value;
  void invoke("perf_probe_mark", payload).catch(() => {});
}

/** Loads the probe configuration. Returns null when the probe is disabled. */
export async function loadPerfProbe(): Promise<PerfProbeConfig | null> {
  if (typeof window === "undefined" || !isTauri()) return null;
  try {
    const config = await invoke<PerfProbeConfig | null>("perf_probe_config");
    probeEnabled = config !== null;
    return config;
  } catch {
    probeEnabled = false;
    return null;
  }
}

/**
 * Emits `ready` after two animation frames, so the first interactive frame has
 * been committed before the mark is sent. The mark's timestamp is taken when
 * the Rust side receives it.
 */
export async function markReady(queueLength: number): Promise<void> {
  if (!probeEnabled) return;
  await nextFrame();
  await nextFrame();
  perfMark("ready", queueLength);
}

/**
 * Drives the automated scenario: optional import, wait for thumbnail work to go
 * quiet, optional scroll test, then `probe_done`. Any failure emits a
 * `probe_error*` mark and stops without `probe_done`.
 */
export async function runPerfProbe(config: PerfProbeConfig, hooks: PerfProbeHooks): Promise<void> {
  if (!probeEnabled) return;
  try {
    if (config.importPath) {
      const before = hooks.queueLength();
      await hooks.importPaths([config.importPath]);
      if (!(await waitUntil(() => !hooks.isImporting(), IMPORT_TIMEOUT_MS))) {
        perfMark("probe_error_import_timeout");
        return;
      }
      perfMark("probe_import_settled", hooks.queueLength());
      if (hooks.queueLength() <= before) {
        perfMark("probe_error_import");
        return;
      }
    }
    if (!(await waitForQuiescence(hooks))) return;
    if (config.scroll) {
      const refresh = await withFrameWatchdog(
        (onFrame) => estimateRefreshIntervalMs(REFRESH_SAMPLE_MS, onFrame),
        REFRESH_SAMPLE_MS + FRAME_WATCHDOG_GRACE_MS,
      );
      if ("timedOut" in refresh) {
        perfMark("probe_error_frame_timeout", refresh.frames);
        return;
      }
      perfMark("scroll_refresh_interval_ms", refresh.result);
      const scroll = await withFrameWatchdog(
        (onFrame) => runScrollTest(config.scrollDurationMs, onFrame),
        config.scrollDurationMs + FRAME_WATCHDOG_GRACE_MS,
      );
      if ("timedOut" in scroll) {
        perfMark("probe_error_frame_timeout", scroll.frames);
        return;
      }
      const outcome = scroll.result;
      if ("error" in outcome) {
        perfMark(outcome.error);
        return;
      }
      perfMark("scroll_intervals", outcome.stats.intervals);
      perfMark("scroll_interval_p50_ms", outcome.stats.p50Ms);
      perfMark("scroll_interval_p95_ms", outcome.stats.p95Ms);
      perfMark("scroll_interval_p99_ms", outcome.stats.p99Ms);
      perfMark("scroll_interval_max_ms", outcome.stats.maxMs);
      perfMark("scroll_long_intervals", outcome.stats.longIntervals);
      perfMark("scroll_distance_px", outcome.distancePx);
      perfMark("scroll_px_per_s", outcome.pxPerSecond);
      // Scrolling triggers lazy thumbnails; let them finish before idle sampling.
      if (!(await waitForQuiescence(hooks))) return;
    }
    perfMark("probe_done", hooks.queueLength());
  } catch {
    perfMark("probe_error");
  }
}

async function waitForQuiescence(hooks: PerfProbeHooks): Promise<boolean> {
  const quiet = await waitUntil(
    () => !hooks.isImporting() && hooks.pendingThumbnails() === 0,
    QUIESCENCE_TIMEOUT_MS,
  );
  if (!quiet) {
    perfMark("probe_error_quiescence_timeout", hooks.pendingThumbnails());
    return false;
  }
  perfMark("probe_quiescent", hooks.queueLength());
  return true;
}

export type FrameWatchdogOutcome<T> = { result: T } | { timedOut: true; frames: number };

/**
 * Runs a frame-driven phase under a deadline. The webview can stop delivering
 * animation frames altogether (occluded window, software rendering that takes
 * minutes per frame, a wedged renderer); without this the probe would wait
 * forever and the sampler would only report a generic timeout. `frames` is
 * how many callbacks arrived before the deadline, so the error mark says
 * whether frames were slow or absent.
 */
export function withFrameWatchdog<T>(
  run: (onFrame: () => void) => Promise<T>,
  timeoutMs: number,
): Promise<FrameWatchdogOutcome<T>> {
  let frames = 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true, frames }), timeoutMs);
    run(() => {
      frames += 1;
    }).then(
      (result) => {
        clearTimeout(timer);
        resolve({ result });
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Median requestAnimationFrame interval while idle; approximates the refresh period. */
async function estimateRefreshIntervalMs(durationMs: number, onFrame: () => void): Promise<number> {
  const intervals: number[] = [];
  await new Promise<void>((resolve) => {
    let start: number | null = null;
    let last: number | null = null;
    const step = (now: number) => {
      onFrame();
      if (start === null) start = now;
      if (last !== null) intervals.push(now - last);
      last = now;
      if (now - start < durationMs) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  const sorted = [...intervals].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

type ScrollOutcome =
  | { stats: ScrollIntervalStats; distancePx: number; pxPerSecond: number }
  | { error: "probe_error_no_scroll_container" | "probe_error_scroll_range" };

/**
 * Scrolls the workspace to the bottom and back over `durationMs` using a
 * triangle wave driven by requestAnimationFrame, recording callback intervals.
 * The intervals measure animation-callback scheduling, not presented frames.
 */
async function runScrollTest(durationMs: number, onFrame: () => void): Promise<ScrollOutcome> {
  const container = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
  if (!container) return { error: "probe_error_no_scroll_container" };
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScroll <= 0) return { error: "probe_error_scroll_range" };
  const intervals: number[] = [];
  container.scrollTop = 0;
  await nextFrame();
  onFrame();

  let lastTop = 0;
  let distancePx = 0;
  await new Promise<void>((resolve) => {
    let start: number | null = null;
    let last: number | null = null;
    const step = (now: number) => {
      onFrame();
      if (start === null) start = now;
      if (last !== null) intervals.push(now - last);
      last = now;
      const progress = Math.min(1, (now - start) / durationMs);
      // 0 → 1 → 0 over the duration.
      const wave = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      const target = Math.round(maxScroll * wave);
      container.scrollTop = target;
      const actual = container.scrollTop;
      distancePx += Math.abs(actual - lastTop);
      lastTop = actual;
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  return {
    stats: summarizeIntervals(intervals),
    distancePx,
    pxPerSecond: distancePx / (durationMs / 1000),
  };
}

export function summarizeIntervals(intervals: number[]): ScrollIntervalStats {
  if (intervals.length === 0) {
    return { intervals: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, longIntervals: 0 };
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    intervals: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
    longIntervals: sorted.filter((value) => value > LONG_INTERVAL_MS).length,
  };
}

/** Nearest-rank percentile on an ascending array. */
export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Polls `predicate` until true; resolves false on timeout instead of throwing. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}
