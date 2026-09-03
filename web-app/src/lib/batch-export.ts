import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";

import type { QueueConversionResult, QueueEntry } from "./queue";

export const BATCH_ARCHIVE_FILE_NAME = "imgconvert-results.zip";
export const BATCH_FAILURE_MANIFEST_NAME = "imgconvert-failures.json";
export const BATCH_FAILURE_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
export const BATCH_ARCHIVE_FIXED_OVERHEAD_BYTES = 1024;
export const BATCH_ARCHIVE_ENTRY_OVERHEAD_BYTES = 512;

const MAX_BATCH_FILE_NAME_CODE_POINTS = 200;
const WINDOWS_DEVICE_NAME = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export interface BatchExportArtifact {
  readonly blob: Blob;
  readonly name: string;
  readonly result?: QueueConversionResult;
}

export interface BatchExportFailure {
  readonly code: string;
  readonly pageNumber?: number;
  readonly sourceName: string;
}

export interface BatchExportPlan {
  readonly archiveAllowed: boolean;
  readonly artifacts: readonly BatchExportArtifact[];
  readonly estimatedArchiveBytes: number;
  readonly failureCount: number;
  readonly outputCount: number;
  readonly outputFormats: readonly QueueConversionResult["format"][];
}

export type BatchExportUiState =
  | "archive-complete"
  | "archive-error"
  | "archiving"
  | "cancelled"
  | "directory-complete"
  | "directory-error"
  | "idle"
  | "writing";

interface FailureManifest {
  readonly failedCount: number;
  readonly failures: readonly BatchExportFailure[];
  readonly schemaVersion: 1;
  readonly status: "partial";
}

function codePoints(value: string): string[] {
  return [...value];
}

function splitExtension(name: string): Readonly<{ base: string; extension: string }> {
  const extensionOffset = name.lastIndexOf(".");
  if (extensionOffset <= 0 || extensionOffset === name.length - 1) {
    return { base: name, extension: "" };
  }
  return { base: name.slice(0, extensionOffset), extension: name.slice(extensionOffset) };
}

function truncateFileName(name: string, suffix = ""): string {
  const { base, extension } = splitExtension(name);
  const available = Math.max(
    1,
    MAX_BATCH_FILE_NAME_CODE_POINTS - codePoints(extension).length - codePoints(suffix).length,
  );
  return `${codePoints(base).slice(0, available).join("")}${suffix}${extension}`;
}

export function sanitizeBatchFileName(value: string, fallback = "converted-image"): string {
  const normalized = codePoints(value.normalize("NFC"))
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      const control = point <= 0x1f || (point >= 0x7f && point <= 0x9f);
      const bidirectionalControl =
        point === 0x061c ||
        point === 0x200e ||
        point === 0x200f ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069);
      return control || bidirectionalControl ? "-" : character;
    })
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/[.\s-]{2,}/gu, "-")
    .replace(/^[.\s-]+|[.\s]+$/gu, "")
    .trim();
  const usable = normalized && normalized !== "." ? normalized : fallback;
  const nonReserved = WINDOWS_DEVICE_NAME.test(usable) ? `_${usable}` : usable;
  return truncateFileName(nonReserved);
}

export function isSafeBatchFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value === sanitizeBatchFileName(value) &&
    codePoints(value).length <= MAX_BATCH_FILE_NAME_CODE_POINTS
  );
}

export function fileNameWithCollisionSuffix(value: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 2) {
    throw new RangeError("Collision sequence must be an integer greater than 1.");
  }
  return truncateFileName(value, ` (${sequence})`);
}

function collisionKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function reserveUniqueBatchFileName(value: string, used: Set<string>): string {
  const safe = sanitizeBatchFileName(value);
  let candidate = safe;
  let sequence = 2;
  while (used.has(collisionKey(candidate))) {
    candidate = fileNameWithCollisionSuffix(safe, sequence);
    sequence += 1;
  }
  used.add(collisionKey(candidate));
  return candidate;
}

function entryResults(entry: QueueEntry): QueueConversionResult[] {
  return entry.result
    ? [entry.result, ...(entry.additionalResults ?? [])]
    : (entry.additionalResults ?? []);
}

function manifestSourceName(value: string): string {
  const bounded = codePoints(value.normalize("NFC"))
    .slice(0, 1024)
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f ||
        (point >= 0x7f && point <= 0x9f) ||
        point === 0x061c ||
        point === 0x200e ||
        point === 0x200f ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069)
        ? "�"
        : character;
    })
    .join("");
  return bounded || "unnamed-input";
}

function collectFailures(entries: readonly QueueEntry[]): BatchExportFailure[] {
  const failures: BatchExportFailure[] = [];
  for (const entry of entries) {
    const sourceName = manifestSourceName(entry.name);
    if (entry.failure) failures.push({ code: entry.failure.code, sourceName });
    else if (entry.conversionFailure) {
      failures.push({ code: entry.conversionFailure.code, sourceName });
    } else if (entry.state === "cancelled") {
      failures.push({ code: "cancelled", sourceName });
    }
    for (const page of entry.pageFailures ?? []) {
      failures.push({
        code: page.failure.code,
        pageNumber: page.pageNumber,
        sourceName,
      });
    }
  }
  return failures;
}

export function serializeFailureManifest(failures: readonly BatchExportFailure[]): string {
  const manifest: FailureManifest = {
    failedCount: failures.length,
    failures,
    schemaVersion: 1,
    status: "partial",
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > BATCH_FAILURE_MANIFEST_MAX_BYTES) {
    throw new RangeError("Batch failure manifest exceeds its byte limit.");
  }
  return serialized;
}

export function estimateArchiveBytes(artifacts: readonly BatchExportArtifact[]): number {
  let estimate = BATCH_ARCHIVE_FIXED_OVERHEAD_BYTES;
  for (const artifact of artifacts) {
    const nameBytes = new TextEncoder().encode(artifact.name).byteLength;
    estimate += artifact.blob.size + BATCH_ARCHIVE_ENTRY_OVERHEAD_BYTES + nameBytes * 2;
    if (!Number.isSafeInteger(estimate)) return Number.MAX_SAFE_INTEGER;
  }
  return estimate;
}

export function createBatchExportPlan(entries: readonly QueueEntry[]): BatchExportPlan {
  const used = new Set<string>();
  const artifacts: BatchExportArtifact[] = [];
  const outputFormats = new Set<QueueConversionResult["format"]>();

  for (const entry of entries) {
    for (const result of entryResults(entry)) {
      const name = reserveUniqueBatchFileName(result.name, used);
      artifacts.push({ blob: result.blob, name, result });
      outputFormats.add(result.format);
    }
  }

  const failures = collectFailures(entries);
  if (failures.length > 0) {
    const manifest = serializeFailureManifest(failures);
    artifacts.push({
      blob: new Blob([manifest], { type: "application/json" }),
      name: reserveUniqueBatchFileName(BATCH_FAILURE_MANIFEST_NAME, used),
    });
  }
  const estimatedArchiveBytes = estimateArchiveBytes(artifacts);
  return Object.freeze({
    archiveAllowed: estimatedArchiveBytes <= WEB_V1_DESKTOP_LIMITS.maxFallbackArchiveBytes,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze(artifact))),
    estimatedArchiveBytes,
    failureCount: failures.length,
    outputCount: artifacts.filter(({ result }) => result !== undefined).length,
    outputFormats: Object.freeze([...outputFormats].sort()),
  });
}
