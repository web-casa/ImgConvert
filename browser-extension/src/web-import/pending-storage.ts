// SPDX-License-Identifier: Apache-2.0
import {
  MAX_PENDING_IMPORT_BYTES,
  pendingImportSerializedBytes,
  validatePendingImageImport,
  type PendingImageImport,
} from "./descriptor";

export const PENDING_IMPORT_STORAGE_PREFIX = "imgconvert.pendingImport";

export interface PendingImportSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

const claimGates = new Map<string, Promise<void>>();

function validWindowId(windowId: number | undefined): windowId is number {
  return Number.isSafeInteger(windowId) && (windowId ?? -1) >= 0;
}

export function pendingImportStorageKey(windowId: number | undefined): string {
  return `${PENDING_IMPORT_STORAGE_PREFIX}.${validWindowId(windowId) ? windowId : "current"}`;
}

export function isPendingImportStorageKey(key: string): boolean {
  return (
    key === `${PENDING_IMPORT_STORAGE_PREFIX}.current` ||
    new RegExp(`^${PENDING_IMPORT_STORAGE_PREFIX.replaceAll(".", "\\.")}\\.\\d+$`, "u").test(key)
  );
}

export async function storePendingImageImport(
  session: PendingImportSessionStorage,
  windowId: number | undefined,
  descriptor: PendingImageImport,
): Promise<void> {
  const serializedBytes = pendingImportSerializedBytes(descriptor);
  if (serializedBytes === undefined || serializedBytes > MAX_PENDING_IMPORT_BYTES) {
    throw new RangeError("Pending web-image descriptor exceeds its storage budget");
  }
  await session.set({ [pendingImportStorageKey(windowId)]: descriptor });
}

async function takeWithoutLock(
  session: PendingImportSessionStorage,
  key: string,
  now: number,
): Promise<PendingImageImport | undefined> {
  const stored = await session.get(key);
  await session.remove(key);
  return validatePendingImageImport(stored[key], now);
}

export async function takePendingImageImport(
  session: PendingImportSessionStorage,
  windowId: number | undefined,
  now = Date.now(),
): Promise<PendingImageImport | undefined> {
  const key = pendingImportStorageKey(windowId);
  const previous = claimGates.get(key) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  claimGates.set(key, current);

  await previous;
  try {
    return await takeWithoutLock(session, key, now);
  } finally {
    releaseCurrent?.();
    if (claimGates.get(key) === current) claimGates.delete(key);
  }
}
