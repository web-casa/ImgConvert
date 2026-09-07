// SPDX-License-Identifier: Apache-2.0
import { releaseOptionalHostPermission } from "../web-import/permissions";
import { isPendingImportNonce, isRemotePermissionPattern } from "../web-import/descriptor";
import type { WebImportPermissionLeaseIdentity } from "../web-import/permission-lease-protocol";

export const WEB_IMPORT_PERMISSION_LEASE_STORAGE_PREFIX = "imgconvert.permissionLease";

const WEB_IMPORT_PERMISSION_LEASE_SCHEMA_VERSION = 1;

type WebImportPermissionLeaseState = "granted" | "prepared";

interface StoredWebImportPermissionLease extends WebImportPermissionLeaseIdentity {
  readonly createdAt: number;
  readonly schemaVersion: typeof WEB_IMPORT_PERMISSION_LEASE_SCHEMA_VERSION;
  readonly state: WebImportPermissionLeaseState;
}

export interface PermissionLeaseStorage {
  get(keys: null | string): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface PermissionLeasePermissions {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

const patternGates = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validWindowId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateStoredLease(value: unknown): StoredWebImportPermissionLease | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "createdAt",
      "nonce",
      "permissionPattern",
      "schemaVersion",
      "state",
      "windowId",
    ]) ||
    value.schemaVersion !== WEB_IMPORT_PERMISSION_LEASE_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    !isPendingImportNonce(value.nonce) ||
    !isRemotePermissionPattern(value.permissionPattern) ||
    !validWindowId(value.windowId) ||
    (value.state !== "prepared" && value.state !== "granted")
  ) {
    return undefined;
  }
  return Object.freeze({
    createdAt: value.createdAt as number,
    nonce: value.nonce,
    permissionPattern: value.permissionPattern,
    schemaVersion: WEB_IMPORT_PERMISSION_LEASE_SCHEMA_VERSION,
    state: value.state,
    windowId: value.windowId,
  });
}

async function withPatternGate<T>(
  permissionPattern: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = patternGates.get(permissionPattern) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  patternGates.set(permissionPattern, current);
  await previous;
  try {
    return await operation();
  } finally {
    releaseCurrent?.();
    if (patternGates.get(permissionPattern) === current) patternGates.delete(permissionPattern);
  }
}

function leaseMatches(
  lease: StoredWebImportPermissionLease,
  identity: WebImportPermissionLeaseIdentity,
): boolean {
  return (
    lease.nonce === identity.nonce &&
    lease.permissionPattern === identity.permissionPattern &&
    lease.windowId === identity.windowId
  );
}

function sameStoredLease(
  left: StoredWebImportPermissionLease,
  right: StoredWebImportPermissionLease,
): boolean {
  return (
    leaseMatches(left, right) &&
    left.createdAt === right.createdAt &&
    left.schemaVersion === right.schemaVersion &&
    left.state === right.state
  );
}

function storedLease(
  identity: WebImportPermissionLeaseIdentity,
  state: WebImportPermissionLeaseState,
  createdAt = Date.now(),
): StoredWebImportPermissionLease {
  return Object.freeze({
    createdAt,
    nonce: identity.nonce,
    permissionPattern: identity.permissionPattern,
    schemaVersion: WEB_IMPORT_PERMISSION_LEASE_SCHEMA_VERSION,
    state,
    windowId: identity.windowId,
  });
}

function validLeases(stored: Record<string, unknown>): StoredWebImportPermissionLease[] {
  return Object.entries(stored)
    .filter(([key]) => isWebImportPermissionLeaseStorageKey(key))
    .map(([, value]) => validateStoredLease(value))
    .filter((lease): lease is StoredWebImportPermissionLease => lease !== undefined);
}

export function webImportPermissionLeaseStorageKey(nonce: string): string {
  return `${WEB_IMPORT_PERMISSION_LEASE_STORAGE_PREFIX}.${nonce}`;
}

export function isWebImportPermissionLeaseStorageKey(key: string): boolean {
  const prefix = `${WEB_IMPORT_PERMISSION_LEASE_STORAGE_PREFIX}.`;
  return key.startsWith(prefix) && isPendingImportNonce(key.slice(prefix.length));
}

export async function registerWebImportPermissionLease(
  storage: PermissionLeaseStorage,
  permissions: PermissionLeasePermissions,
  identity: WebImportPermissionLeaseIdentity,
  now = Date.now(),
): Promise<Readonly<{ permissionPreexisting: boolean }>> {
  return withPatternGate(identity.permissionPattern, async () => {
    const allStored = await storage.get(null);
    const leases = validLeases(allStored);
    const permissionGranted = await permissions.contains({ origins: [identity.permissionPattern] });
    const managedLeaseExists = leases.some(
      (lease) => lease.permissionPattern === identity.permissionPattern,
    );
    if (permissionGranted && !managedLeaseExists) {
      return Object.freeze({ permissionPreexisting: true });
    }

    await storage.set({
      [webImportPermissionLeaseStorageKey(identity.nonce)]: storedLease(identity, "prepared", now),
    });
    return Object.freeze({ permissionPreexisting: false });
  });
}

export async function markWebImportPermissionLeaseGranted(
  storage: PermissionLeaseStorage,
  permissions: PermissionLeasePermissions,
  identity: WebImportPermissionLeaseIdentity,
): Promise<boolean> {
  return withPatternGate(identity.permissionPattern, async () => {
    const key = webImportPermissionLeaseStorageKey(identity.nonce);
    const lease = validateStoredLease((await storage.get(key))[key]);
    if (!lease || !leaseMatches(lease, identity)) {
      const remaining = validLeases(await storage.get(null));
      if (
        !remaining.some((candidate) => candidate.permissionPattern === identity.permissionPattern)
      ) {
        // A request can resolve after its owning Port disconnected and removed
        // the prepared record. Persist recovery state before trying to revoke
        // that late grant so a transient permissions API failure is retryable.
        await storage.set({ [key]: storedLease(identity, "granted") });
        if (await releaseOptionalHostPermission(permissions, identity.permissionPattern)) {
          await storage.remove(key);
        }
      }
      return false;
    }
    if (!(await permissions.contains({ origins: [identity.permissionPattern] }))) return false;
    await storage.set({ [key]: Object.freeze({ ...lease, state: "granted" }) });
    return true;
  });
}

export async function releaseWebImportPermissionLease(
  storage: PermissionLeaseStorage,
  permissions: PermissionLeasePermissions,
  identity: WebImportPermissionLeaseIdentity,
): Promise<boolean> {
  return withPatternGate(identity.permissionPattern, async () => {
    const key = webImportPermissionLeaseStorageKey(identity.nonce);
    const lease = validateStoredLease((await storage.get(key))[key]);
    if (!lease || !leaseMatches(lease, identity)) {
      return !(await permissions.contains({ origins: [identity.permissionPattern] }));
    }

    const remaining = validLeases(await storage.get(null));
    if (
      remaining.some(
        (candidate) =>
          candidate.nonce !== lease.nonce &&
          candidate.permissionPattern === identity.permissionPattern,
      )
    ) {
      await storage.remove(key);
      return true;
    }

    const released = await releaseOptionalHostPermission(permissions, identity.permissionPattern);
    if (released) await storage.remove(key);
    return released;
  });
}

export async function cleanupOrphanedWebImportPermissionLeases(
  storage: PermissionLeaseStorage,
  permissions: PermissionLeasePermissions,
): Promise<Readonly<{ cleaned: number; failed: number; invalid: number }>> {
  const allStored = await storage.get(null);
  const invalidKeys: string[] = [];
  const groups = new Map<string, StoredWebImportPermissionLease[]>();
  for (const [key, value] of Object.entries(allStored)) {
    if (!key.startsWith(`${WEB_IMPORT_PERMISSION_LEASE_STORAGE_PREFIX}.`)) continue;
    const lease = validateStoredLease(value);
    if (
      !isWebImportPermissionLeaseStorageKey(key) ||
      !lease ||
      webImportPermissionLeaseStorageKey(lease.nonce) !== key
    ) {
      invalidKeys.push(key);
      continue;
    }
    const group = groups.get(lease.permissionPattern) ?? [];
    group.push(lease);
    groups.set(lease.permissionPattern, group);
  }
  if (invalidKeys.length > 0) await storage.remove(invalidKeys);

  let cleaned = 0;
  let failed = 0;
  for (const [permissionPattern, leases] of groups) {
    await withPatternGate(permissionPattern, async () => {
      const currentStored = await storage.get(null);
      const currentLeases = validLeases(currentStored);
      const capturedByNonce = new Map(leases.map((lease) => [lease.nonce, lease]));
      const removable = currentLeases.filter((lease) => {
        const captured = capturedByNonce.get(lease.nonce);
        return captured !== undefined && sameStoredLease(lease, captured);
      });
      if (removable.length === 0) return;

      const removedNonces = new Set(removable.map(({ nonce }) => nonce));
      const activeLease = currentLeases.some(
        (lease) => !removedNonces.has(lease.nonce) && lease.permissionPattern === permissionPattern,
      );
      if (activeLease) {
        await storage.remove(
          removable.map(({ nonce }) => webImportPermissionLeaseStorageKey(nonce)),
        );
        cleaned += removable.length;
        return;
      }

      if (!(await releaseOptionalHostPermission(permissions, permissionPattern))) {
        failed += removable.length;
        return;
      }
      await storage.remove(removable.map(({ nonce }) => webImportPermissionLeaseStorageKey(nonce)));
      cleaned += removable.length;
    });
  }
  return Object.freeze({ cleaned, failed, invalid: invalidKeys.length });
}
