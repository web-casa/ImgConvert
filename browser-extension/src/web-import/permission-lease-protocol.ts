// SPDX-License-Identifier: Apache-2.0
import { isPendingImportNonce, isRemotePermissionPattern } from "./descriptor";

export const WEB_IMPORT_PERMISSION_LEASE_PORT = "imgconvert.webImportPermissionLease";
export const REGISTER_WEB_IMPORT_PERMISSION_LEASE = "imgconvert.registerWebImportPermissionLease";
export const KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE =
  "imgconvert.keepAliveWebImportPermissionLease";
export const REQUEST_WEB_IMPORT_PERMISSION = "imgconvert.requestWebImportPermission";
export const RELEASE_WEB_IMPORT_PERMISSION = "imgconvert.releaseWebImportPermission";

export interface WebImportPermissionLeaseIdentity {
  readonly nonce: string;
  readonly permissionPattern: string;
  readonly windowId: number;
}

export interface RegisterWebImportPermissionLeaseMessage extends WebImportPermissionLeaseIdentity {
  readonly type: typeof REGISTER_WEB_IMPORT_PERMISSION_LEASE;
}

export interface RequestWebImportPermissionMessage extends WebImportPermissionLeaseIdentity {
  readonly type: typeof REQUEST_WEB_IMPORT_PERMISSION;
}

export interface KeepAliveWebImportPermissionLeaseMessage extends WebImportPermissionLeaseIdentity {
  readonly type: typeof KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE;
}

export interface ReleaseWebImportPermissionMessage extends WebImportPermissionLeaseIdentity {
  readonly type: typeof RELEASE_WEB_IMPORT_PERMISSION;
}

export type RegisterWebImportPermissionLeaseResponse =
  | Readonly<{ nonce: string; ok: true; permissionPreexisting: boolean }>
  | Readonly<{ error: "registration-failed"; nonce: string; ok: false }>;

export type RequestWebImportPermissionResponse =
  | Readonly<{ granted: boolean; ok: true }>
  | Readonly<{
      error: "lease-expired" | "permission-request-failed" | "untrusted-sender";
      ok: false;
    }>;

export type ReleaseWebImportPermissionResponse = Readonly<{ ok: true; released: boolean }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isLeaseIdentity(value: Record<string, unknown>): boolean {
  return (
    isPendingImportNonce(value.nonce) &&
    isRemotePermissionPattern(value.permissionPattern) &&
    Number.isSafeInteger(value.windowId) &&
    (value.windowId as number) >= 0
  );
}

export function permissionLeaseIdentity(
  value: WebImportPermissionLeaseIdentity,
): WebImportPermissionLeaseIdentity {
  return Object.freeze({
    nonce: value.nonce,
    permissionPattern: value.permissionPattern,
    windowId: value.windowId,
  });
}

export function isRegisterWebImportPermissionLeaseMessage(
  value: unknown,
): value is RegisterWebImportPermissionLeaseMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["nonce", "permissionPattern", "type", "windowId"]) &&
    value.type === REGISTER_WEB_IMPORT_PERMISSION_LEASE &&
    isLeaseIdentity(value)
  );
}

export function isRequestWebImportPermissionMessage(
  value: unknown,
): value is RequestWebImportPermissionMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["nonce", "permissionPattern", "type", "windowId"]) &&
    value.type === REQUEST_WEB_IMPORT_PERMISSION &&
    isLeaseIdentity(value)
  );
}

export function isKeepAliveWebImportPermissionLeaseMessage(
  value: unknown,
): value is KeepAliveWebImportPermissionLeaseMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["nonce", "permissionPattern", "type", "windowId"]) &&
    value.type === KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE &&
    isLeaseIdentity(value)
  );
}

export function isReleaseWebImportPermissionMessage(
  value: unknown,
): value is ReleaseWebImportPermissionMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["nonce", "permissionPattern", "type", "windowId"]) &&
    value.type === RELEASE_WEB_IMPORT_PERMISSION &&
    isLeaseIdentity(value)
  );
}

export function validateRegisterWebImportPermissionLeaseResponse(
  value: unknown,
  nonce: string,
): RegisterWebImportPermissionLeaseResponse | undefined {
  if (!isRecord(value) || value.nonce !== nonce || typeof value.ok !== "boolean") return undefined;
  if (value.ok) {
    return hasExactKeys(value, ["nonce", "ok", "permissionPreexisting"]) &&
      typeof value.permissionPreexisting === "boolean"
      ? Object.freeze({ nonce, ok: true, permissionPreexisting: value.permissionPreexisting })
      : undefined;
  }
  return hasExactKeys(value, ["error", "nonce", "ok"]) && value.error === "registration-failed"
    ? Object.freeze({ error: "registration-failed", nonce, ok: false })
    : undefined;
}

export function validateRequestWebImportPermissionResponse(
  value: unknown,
): RequestWebImportPermissionResponse | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean") return undefined;
  if (value.ok) {
    return hasExactKeys(value, ["granted", "ok"]) && typeof value.granted === "boolean"
      ? Object.freeze({ granted: value.granted, ok: true })
      : undefined;
  }
  return hasExactKeys(value, ["error", "ok"]) &&
    (value.error === "lease-expired" ||
      value.error === "permission-request-failed" ||
      value.error === "untrusted-sender")
    ? Object.freeze({ error: value.error, ok: false })
    : undefined;
}

export function validateReleaseWebImportPermissionResponse(
  value: unknown,
): ReleaseWebImportPermissionResponse | undefined {
  return isRecord(value) &&
    hasExactKeys(value, ["ok", "released"]) &&
    value.ok === true &&
    typeof value.released === "boolean"
    ? Object.freeze({ ok: true, released: value.released })
    : undefined;
}
