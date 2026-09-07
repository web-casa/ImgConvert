import { WEB_V1_DESKTOP_LIMITS } from "@imgconvert/conversion-contract";
import {
  fileNameWithCollisionSuffix,
  isSafeBatchFileName,
  reserveUniqueBatchFileName,
  sanitizeBatchFileName,
} from "./file-names.js";

import type { QueueConversionResult, QueueEntry } from "./queue.js";

export const BATCH_ARCHIVE_FILE_NAME = "imgconvert-results.zip";
export const BATCH_FAILURE_MANIFEST_NAME = "imgconvert-failures.json";
export const BATCH_FAILURE_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
export const BATCH_ARCHIVE_FIXED_OVERHEAD_BYTES = 1024;
export const BATCH_ARCHIVE_ENTRY_OVERHEAD_BYTES = 512;

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

export {
  fileNameWithCollisionSuffix,
  isSafeBatchFileName,
  reserveUniqueBatchFileName,
  sanitizeBatchFileName,
};

function codePoints(value: string): string[] {
  return [...value];
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
