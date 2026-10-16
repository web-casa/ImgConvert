// SPDX-License-Identifier: Apache-2.0

export interface ProbeMark {
  mark: string;
  unixMs: number;
  elapsedMs: number | null;
  value: number | null;
}

export interface Summary {
  n: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export interface RunValidationInput {
  exitedEarly: boolean;
  idleSamples: number;
  samplesFailed: number;
  rootMissing: number;
  samplesMissingMemory: number;
  purgeApplied: boolean;
  idleRssBytes: number | null;
  idleAltBytes: number | null;
  importCount: number | null;
  scrollDistancePx: number | null;
  scrollIntervals?: number | null;
  scrollRefreshIntervalMs?: number | null;
  scrollIntervalP50Ms?: number | null;
  scrollIntervalP95Ms?: number | null;
  scrollIntervalP99Ms?: number | null;
  scrollIntervalMaxMs?: number | null;
  scrollLongIntervals?: number | null;
  batchCount?: number | null;
  batchDoneCount?: number | null;
  batchSamples?: number | null;
}

export interface RunExpectations {
  purge?: boolean;
  corpusCount?: number;
  requireAlt?: boolean;
}

export const ERROR_MARK_PREFIX: string;
export const REQUIRED_MARKS: Record<string, string[]>;
export const MIN_IDLE_SAMPLES: number;

export function percentile(values: number[], fraction: number): number | null;
export function median(values: number[]): number | null;
export function summarize(values: unknown[]): Summary | null;
export function parseProbeLine(line: string): ProbeMark | null;
export function descendants(
  processes: Map<number, { pid: number; ppid: number }>,
  rootPid: number,
): Set<number>;
export function samplesInWindow<T extends { t: number }>(
  samples: T[],
  startMs: number,
  endMs: number,
): T[];
export function validateRun(
  scenario: string,
  run: RunValidationInput,
  marks: Map<string, { unixMs: number }>,
  expectations?: RunExpectations,
): string[];
export function outputPaths(
  outOption: string | undefined,
  defaultJsonPath: string,
): { json: string; markdown: string };
export function markUnix(marks: Map<string, { unixMs: number }>, name: string): number | null;
export function markValue(
  marks: Map<string, { value?: number | null }>,
  name: string,
): number | null;
export function diffMs(
  marks: Map<string, { unixMs: number }>,
  from: string,
  to: string,
): number | null;
