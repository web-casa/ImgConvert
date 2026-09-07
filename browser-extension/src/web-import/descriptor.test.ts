// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  PENDING_IMPORT_TTL_MS,
  createPendingImageImport,
  isPendingImportNonce,
  isRemotePermissionPattern,
  pendingImportSerializedBytes,
  validatePendingImageImport,
} from "./descriptor";

const NOW = 1_800_000_000_000;
const NONCE = "123e4567-e89b-42d3-a456-426614174000";

function candidate(sourceUrl: string) {
  return {
    documentUrl: "https://photos.example.net/gallery",
    nonce: NONCE,
    now: NOW,
    sourceUrl,
  };
}

describe("pending web-image descriptor", () => {
  it("canonicalizes an HTTPS image into an exact scheme/host/port grant", () => {
    expect(
      createPendingImageImport(
        candidate("https://CDN.example.net:8443/path/photo%201.png#preview"),
      ),
    ).toEqual({
      createdAt: NOW,
      displayName: "photo 1.png",
      kind: "remote",
      nonce: NONCE,
      permissionPattern: "https://cdn.example.net:8443/*",
      schemaVersion: 1,
      sourceOrigin: "https://cdn.example.net:8443",
      sourceUrl: "https://cdn.example.net:8443/path/photo%201.png",
    });
  });

  it("removes bidirectional control characters from an untrusted URL filename", () => {
    const descriptor = createPendingImageImport(
      candidate("https://cdn.example.net/report%E2%80%AEgnp.exe"),
    );

    expect(descriptor).toMatchObject({
      displayName: "reportgnp.exe",
      kind: "remote",
    });
    expect(JSON.stringify(descriptor)).not.toContain("\u202e");
  });

  it.each([
    ["data:image/png;base64,AAAA", "unsupported-scheme"],
    ["blob:https://photos.example.net/id", "unsupported-scheme"],
    ["file:///tmp/private.png", "unsupported-scheme"],
    ["http://cdn.example.net/a.png", "unsupported-scheme"],
    ["https://localhost:8080/a.png", "private-host"],
    ["https://127.1/a.png", "private-host"],
    ["https://[::1]/a.png", "private-host"],
    ["https://printer.local/a.png", "private-host"],
    ["https://127-0-0-1.nip.io/a.png", "private-host"],
    ["https://10.0.0.1.sslip.io/a.png", "private-host"],
    ["https://customer.localtest.me/a.png", "private-host"],
    ["https://lvh.me/a.png", "private-host"],
    ["https://app.vcap.me/a.png", "private-host"],
    ["https://user:secret@cdn.example.net/a.png", "embedded-credentials"],
  ])("blocks %s without retaining the source bytes or URL", (sourceUrl, code) => {
    const descriptor = createPendingImageImport(candidate(sourceUrl));
    expect(descriptor).toMatchObject({ code, kind: "blocked" });
    expect(JSON.stringify(descriptor)).not.toContain(sourceUrl);
    expect(JSON.stringify(descriptor)).not.toContain("AAAA");
    expect(JSON.stringify(descriptor)).not.toContain("secret");
  });

  it("blocks image contexts from non-web documents", () => {
    expect(
      createPendingImageImport({
        ...candidate("https://cdn.example.net/a.png"),
        documentUrl: "chrome://settings/",
      }),
    ).toMatchObject({ code: "unsupported-page", kind: "blocked" });
  });

  it("rejects expired, tampered, oversized, and content-bearing stored values", () => {
    const descriptor = createPendingImageImport(candidate("https://cdn.example.net/a.png"));
    expect(validatePendingImageImport(descriptor, NOW)).toEqual(descriptor);
    expect(validatePendingImageImport(descriptor, NOW + PENDING_IMPORT_TTL_MS + 1)).toBeUndefined();
    expect(
      validatePendingImageImport({ ...descriptor, permissionPattern: "https://*/*" }, NOW),
    ).toBeUndefined();
    expect(validatePendingImageImport({ ...descriptor, bytes: "AAAA" }, NOW)).toBeUndefined();
    expect(
      validatePendingImageImport(
        { ...descriptor, sourceUrl: `https://cdn.example.net/${"a".repeat(9000)}` },
        NOW,
      ),
    ).toBeUndefined();
  });

  it("fails closed instead of throwing for cyclic untrusted values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(pendingImportSerializedBytes(cyclic)).toBeUndefined();
    expect(validatePendingImageImport(cyclic, NOW)).toBeUndefined();
  });

  it("measures the storage budget as UTF-8 bytes", () => {
    expect(pendingImportSerializedBytes("图")).toBe(5);
  });

  it("validates only canonical public HTTPS permission identities", () => {
    expect(isPendingImportNonce(NONCE)).toBe(true);
    expect(isPendingImportNonce("not-a-nonce")).toBe(false);
    expect(isRemotePermissionPattern("https://cdn.example.net:8443/*")).toBe(true);
    expect(isRemotePermissionPattern("https://cdn.example.net/images/*")).toBe(false);
    expect(isRemotePermissionPattern("https://127.0.0.1/*")).toBe(false);
    expect(isRemotePermissionPattern("http://cdn.example.net/*")).toBe(false);
    expect(isRemotePermissionPattern("https://*/*")).toBe(false);
  });
});
