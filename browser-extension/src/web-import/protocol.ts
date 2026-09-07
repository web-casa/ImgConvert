// SPDX-License-Identifier: Apache-2.0
import { validatePendingImageImport, type PendingImageImport } from "./descriptor";

export const CLAIM_PENDING_IMPORT = "imgconvert.claimPendingImport";

export interface ClaimPendingImportMessage {
  readonly type: typeof CLAIM_PENDING_IMPORT;
  readonly windowId: number;
}

export type ClaimPendingImportResponse =
  | Readonly<{ descriptor: PendingImageImport; ok: true }>
  | Readonly<{ error: "empty" | "storage-error" | "untrusted-sender"; ok: false }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClaimPendingImportMessage(value: unknown): value is ClaimPendingImportMessage {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.type === CLAIM_PENDING_IMPORT &&
    Number.isSafeInteger(value.windowId) &&
    (value.windowId as number) >= 0
  );
}

export function validateClaimPendingImportResponse(
  value: unknown,
  now = Date.now(),
): ClaimPendingImportResponse | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined;
  if (value.ok) {
    if (Object.keys(value).length !== 2) return undefined;
    const descriptor = validatePendingImageImport(value.descriptor, now);
    return descriptor ? Object.freeze({ descriptor, ok: true }) : undefined;
  }
  if (
    Object.keys(value).length !== 2 ||
    (value.error !== "empty" &&
      value.error !== "storage-error" &&
      value.error !== "untrusted-sender")
  ) {
    return undefined;
  }
  return Object.freeze({ error: value.error, ok: false });
}
