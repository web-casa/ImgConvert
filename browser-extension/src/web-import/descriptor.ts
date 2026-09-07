// SPDX-License-Identifier: Apache-2.0

export const PENDING_IMPORT_SCHEMA_VERSION = 1;
export const PENDING_IMPORT_TTL_MS = 2 * 60 * 1000;
export const MAX_REMOTE_IMAGE_URL_LENGTH = 4096;
export const MAX_PENDING_IMPORT_BYTES = 8192;

const BLOCK_CODES = [
  "embedded-credentials",
  "invalid-url",
  "private-host",
  "unsupported-page",
  "unsupported-scheme",
  "url-too-long",
] as const;

export type PendingImportBlockCode = (typeof BLOCK_CODES)[number];

export interface PendingRemoteImageImport {
  readonly createdAt: number;
  readonly displayName: string;
  readonly kind: "remote";
  readonly nonce: string;
  readonly permissionPattern: string;
  readonly schemaVersion: typeof PENDING_IMPORT_SCHEMA_VERSION;
  readonly sourceOrigin: string;
  readonly sourceUrl: string;
}

export interface PendingBlockedImageImport {
  readonly code: PendingImportBlockCode;
  readonly createdAt: number;
  readonly kind: "blocked";
  readonly nonce: string;
  readonly schemaVersion: typeof PENDING_IMPORT_SCHEMA_VERSION;
  readonly sourceLabel: string;
}

export type PendingImageImport = PendingRemoteImageImport | PendingBlockedImageImport;

export interface PendingImportCandidate {
  readonly documentUrl?: string;
  readonly nonce: string;
  readonly now: number;
  readonly sourceUrl?: string;
}

const BLOCK_CODE_SET = new Set<string>(BLOCK_CODES);
const NON_PUBLIC_SUFFIXES = [
  ".example",
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".test",
] as const;
const NON_PUBLIC_EXACT_HOSTS = new Set([
  "example",
  "home",
  "internal",
  "invalid",
  "lan",
  "local",
  "localhost",
  "test",
]);
// These public wildcard-DNS services intentionally map user-controlled labels
// (or every label) to loopback/private addresses. Chrome does not expose the
// connected response IP without broader network-observation permissions, so
// reject the well-known aliases without claiming this is complete DNS-rebind
// protection.
const PRIVATE_ADDRESS_ALIAS_HOSTS = new Set([
  "localtest.me",
  "lvh.me",
  "nip.io",
  "sslip.io",
  "vcap.me",
]);
const PRIVATE_ADDRESS_ALIAS_SUFFIXES = [...PRIVATE_ADDRESS_ALIAS_HOSTS].map(
  (hostname) => `.${hostname}`,
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export function pendingImportSerializedBytes(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

export function isPendingImportNonce(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isRemotePermissionPattern(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith("/*")) return false;
  const sourceUrl = `${value.slice(0, -1)}imgconvert-permission-check`;
  const rebuilt = createPendingImageImport({
    documentUrl: "https://validation.imgconvert.app/",
    nonce: "123e4567-e89b-42d3-a456-426614174000",
    now: 0,
    sourceUrl,
  });
  return rebuilt.kind === "remote" && rebuilt.permissionPattern === value;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown, now: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) <= now + 5000 &&
    now - (value as number) <= PENDING_IMPORT_TTL_MS
  );
}

function withoutControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .replace(BIDI_CONTROL_PATTERN, "");
}

function safeLabel(value: string): string {
  return withoutControlCharacters(value).trim().slice(0, 160) || "image";
}

function blocked(
  code: PendingImportBlockCode,
  sourceLabel: string,
  now: number,
  nonce: string,
): PendingBlockedImageImport {
  return Object.freeze({
    code,
    createdAt: now,
    kind: "blocked",
    nonce,
    schemaVersion: PENDING_IMPORT_SCHEMA_VERSION,
    sourceLabel: safeLabel(sourceLabel),
  });
}

function isSupportedDocumentUrl(value: string | undefined): boolean {
  if (!value || value.length > MAX_REMOTE_IMAGE_URL_LENGTH) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:";
  } catch {
    return false;
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^\[[0-9a-f:.]+\]$/iu.test(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname);
}

function isNonPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return (
    normalized.length === 0 ||
    !normalized.includes(".") ||
    isIpLiteral(normalized) ||
    NON_PUBLIC_EXACT_HOSTS.has(normalized) ||
    NON_PUBLIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    PRIVATE_ADDRESS_ALIAS_HOSTS.has(normalized) ||
    PRIVATE_ADDRESS_ALIAS_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function displayNameFromUrl(url: URL): string {
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "web-image";
  let decoded = lastSegment;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    // Keep the already bounded URL path segment when percent-decoding fails.
  }
  const cleaned = withoutControlCharacters(decoded)
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/^[.\s]+|[.\s]+$/gu, "")
    .slice(0, 120);
  return cleaned || "web-image";
}

export function createPendingImageImport(candidate: PendingImportCandidate): PendingImageImport {
  if (!isSupportedDocumentUrl(candidate.documentUrl)) {
    return blocked("unsupported-page", "browser page", candidate.now, candidate.nonce);
  }
  if (!candidate.sourceUrl) {
    return blocked("invalid-url", "image", candidate.now, candidate.nonce);
  }
  if (candidate.sourceUrl.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
    return blocked("url-too-long", "image URL", candidate.now, candidate.nonce);
  }

  let url: URL;
  try {
    url = new URL(candidate.sourceUrl);
  } catch {
    return blocked("invalid-url", "image URL", candidate.now, candidate.nonce);
  }
  if (url.protocol !== "https:") {
    return blocked(
      "unsupported-scheme",
      url.protocol.replace(/:$/u, "") || "image",
      candidate.now,
      candidate.nonce,
    );
  }
  if (url.username || url.password) {
    return blocked("embedded-credentials", url.hostname, candidate.now, candidate.nonce);
  }

  const normalizedHostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (isNonPublicHostname(normalizedHostname)) {
    return blocked("private-host", normalizedHostname, candidate.now, candidate.nonce);
  }
  url.hostname = normalizedHostname;
  url.hash = "";
  const sourceUrl = url.href;
  if (sourceUrl.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
    return blocked("url-too-long", normalizedHostname, candidate.now, candidate.nonce);
  }

  return Object.freeze({
    createdAt: candidate.now,
    displayName: displayNameFromUrl(url),
    kind: "remote",
    nonce: candidate.nonce,
    permissionPattern: `${url.protocol}//${url.host}/*`,
    schemaVersion: PENDING_IMPORT_SCHEMA_VERSION,
    sourceOrigin: url.origin,
    sourceUrl,
  });
}

export function validatePendingImageImport(
  value: unknown,
  now = Date.now(),
): PendingImageImport | undefined {
  if (!isRecord(value)) return undefined;
  const serializedBytes = pendingImportSerializedBytes(value);
  if (serializedBytes === undefined || serializedBytes > MAX_PENDING_IMPORT_BYTES) return undefined;
  if (
    value.schemaVersion !== PENDING_IMPORT_SCHEMA_VERSION ||
    !validTimestamp(value.createdAt, now) ||
    !isPendingImportNonce(value.nonce)
  ) {
    return undefined;
  }

  if (value.kind === "blocked") {
    if (
      !hasExactKeys(value, [
        "code",
        "createdAt",
        "kind",
        "nonce",
        "schemaVersion",
        "sourceLabel",
      ]) ||
      typeof value.code !== "string" ||
      !BLOCK_CODE_SET.has(value.code) ||
      typeof value.sourceLabel !== "string" ||
      value.sourceLabel.length < 1 ||
      value.sourceLabel.length > 160 ||
      safeLabel(value.sourceLabel) !== value.sourceLabel
    ) {
      return undefined;
    }
    return Object.freeze({
      code: value.code as PendingImportBlockCode,
      createdAt: value.createdAt,
      kind: "blocked",
      nonce: value.nonce,
      schemaVersion: PENDING_IMPORT_SCHEMA_VERSION,
      sourceLabel: value.sourceLabel,
    });
  }

  if (
    value.kind !== "remote" ||
    !hasExactKeys(value, [
      "createdAt",
      "displayName",
      "kind",
      "nonce",
      "permissionPattern",
      "schemaVersion",
      "sourceOrigin",
      "sourceUrl",
    ]) ||
    typeof value.sourceUrl !== "string" ||
    typeof value.sourceOrigin !== "string" ||
    typeof value.permissionPattern !== "string" ||
    typeof value.displayName !== "string" ||
    value.displayName.length < 1 ||
    value.displayName.length > 120
  ) {
    return undefined;
  }

  const rebuilt = createPendingImageImport({
    documentUrl: "https://validation.imgconvert.app/",
    nonce: value.nonce,
    now: value.createdAt,
    sourceUrl: value.sourceUrl,
  });
  if (
    rebuilt.kind !== "remote" ||
    rebuilt.sourceUrl !== value.sourceUrl ||
    rebuilt.sourceOrigin !== value.sourceOrigin ||
    rebuilt.permissionPattern !== value.permissionPattern ||
    rebuilt.displayName !== value.displayName
  ) {
    return undefined;
  }
  return rebuilt;
}
