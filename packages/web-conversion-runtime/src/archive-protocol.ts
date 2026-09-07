import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";

import { isSafeBatchFileName } from "./file-names.js";

export const ARCHIVE_SCHEMA_VERSION = 1;
export const MAX_ARCHIVE_ENTRIES =
  WEB_V1_DESKTOP_LIMITS.maxQueueFiles * WEB_V1_DESKTOP_LIMITS.maxSelectedPdfPages + 1;

export interface ArchiveInputFile {
  readonly blob: Blob;
  readonly name: string;
}

export interface ArchiveRequest {
  readonly files: readonly ArchiveInputFile[];
  readonly maxBytes: number;
}

export interface ArchiveWorkerCommand {
  readonly executionId: string;
  readonly request: ArchiveRequest;
  readonly schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  readonly type: "create-archive";
}

export interface ArchiveWorkerProgress {
  readonly completed: number;
  readonly executionId: string;
  readonly schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  readonly total: number;
  readonly type: "archive-progress";
}

export type ArchiveFailureReason =
  "archive-too-large" | "cancelled" | "invalid-message" | "invalid-request" | "worker-failed";

export type ArchiveOutcome =
  | Readonly<{ archive: Blob; entryCount: number; ok: true }>
  | Readonly<{ ok: false; reason: ArchiveFailureReason }>;

export interface ArchiveWorkerResult {
  readonly executionId: string;
  readonly outcome: ArchiveOutcome;
  readonly schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  readonly type: "archive-result";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collisionKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function assertArchiveRequest(value: unknown): asserts value is ArchiveRequest {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new TypeError("Archive request files must be an array.");
  }
  if (
    !Number.isSafeInteger(value.maxBytes) ||
    (value.maxBytes as number) < 1 ||
    (value.maxBytes as number) > WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes
  ) {
    throw new RangeError("Archive byte limit is invalid.");
  }
  if (value.files.length < 1 || value.files.length > MAX_ARCHIVE_ENTRIES) {
    throw new RangeError("Archive entry count is outside the configured limit.");
  }
  const used = new Set<string>();
  let sourceBytes = 0;
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      !(file.blob instanceof Blob) ||
      typeof file.name !== "string" ||
      !isSafeBatchFileName(file.name)
    ) {
      throw new TypeError("Archive entry is invalid.");
    }
    const key = collisionKey(file.name);
    if (used.has(key)) throw new TypeError("Archive entry names must be unique.");
    used.add(key);
    sourceBytes += file.blob.size;
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes > (value.maxBytes as number)) {
      throw new RangeError("Archive source bytes exceed the configured limit.");
    }
  }
}

export function isArchiveWorkerProgress(value: unknown): value is ArchiveWorkerProgress {
  return (
    isRecord(value) &&
    value.type === "archive-progress" &&
    value.schemaVersion === ARCHIVE_SCHEMA_VERSION &&
    typeof value.executionId === "string" &&
    value.executionId.length > 0 &&
    Number.isSafeInteger(value.completed) &&
    (value.completed as number) > 0 &&
    Number.isSafeInteger(value.total) &&
    (value.total as number) > 0 &&
    (value.completed as number) <= (value.total as number)
  );
}

const failureReasons = new Set<ArchiveFailureReason>([
  "archive-too-large",
  "cancelled",
  "invalid-message",
  "invalid-request",
  "worker-failed",
]);

export function isArchiveWorkerResult(value: unknown): value is ArchiveWorkerResult {
  if (
    !isRecord(value) ||
    value.type !== "archive-result" ||
    value.schemaVersion !== ARCHIVE_SCHEMA_VERSION ||
    typeof value.executionId !== "string" ||
    value.executionId.length < 1 ||
    !isRecord(value.outcome) ||
    typeof value.outcome.ok !== "boolean"
  ) {
    return false;
  }
  if (!value.outcome.ok) {
    return (
      typeof value.outcome.reason === "string" &&
      failureReasons.has(value.outcome.reason as ArchiveFailureReason)
    );
  }
  return (
    value.outcome.archive instanceof Blob &&
    value.outcome.archive.type === "application/zip" &&
    value.outcome.archive.size > 0 &&
    value.outcome.archive.size <= WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes &&
    Number.isSafeInteger(value.outcome.entryCount) &&
    (value.outcome.entryCount as number) > 0 &&
    (value.outcome.entryCount as number) <= MAX_ARCHIVE_ENTRIES
  );
}
