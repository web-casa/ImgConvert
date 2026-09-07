// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
  REGISTER_WEB_IMPORT_PERMISSION_LEASE,
  RELEASE_WEB_IMPORT_PERMISSION,
  REQUEST_WEB_IMPORT_PERMISSION,
  isRegisterWebImportPermissionLeaseMessage,
  isKeepAliveWebImportPermissionLeaseMessage,
  isReleaseWebImportPermissionMessage,
  isRequestWebImportPermissionMessage,
  validateRegisterWebImportPermissionLeaseResponse,
  validateReleaseWebImportPermissionResponse,
  validateRequestWebImportPermissionResponse,
} from "./permission-lease-protocol";

const identity = Object.freeze({
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  permissionPattern: "https://cdn.example.net:8443/*",
  windowId: 7,
});

describe("web-import permission lease protocol", () => {
  it("accepts only exact, bounded lease messages", () => {
    expect(
      isRegisterWebImportPermissionLeaseMessage({
        ...identity,
        type: REGISTER_WEB_IMPORT_PERMISSION_LEASE,
      }),
    ).toBe(true);
    expect(
      isRequestWebImportPermissionMessage({ ...identity, type: REQUEST_WEB_IMPORT_PERMISSION }),
    ).toBe(true);
    expect(
      isKeepAliveWebImportPermissionLeaseMessage({
        ...identity,
        type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
      }),
    ).toBe(true);
    expect(
      isReleaseWebImportPermissionMessage({ ...identity, type: RELEASE_WEB_IMPORT_PERMISSION }),
    ).toBe(true);
    expect(
      isRequestWebImportPermissionMessage({
        ...identity,
        permissionPattern: "https://*/*",
        type: REQUEST_WEB_IMPORT_PERMISSION,
      }),
    ).toBe(false);
    expect(
      isKeepAliveWebImportPermissionLeaseMessage({
        ...identity,
        sourceUrl: "https://cdn.example.net/private.png",
        type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
      }),
    ).toBe(false);
    expect(
      isRequestWebImportPermissionMessage({
        ...identity,
        sourceUrl: "https://cdn.example.net/private.png",
        type: REQUEST_WEB_IMPORT_PERMISSION,
      }),
    ).toBe(false);
  });

  it("validates registration, request, and release responses", () => {
    expect(
      validateRegisterWebImportPermissionLeaseResponse(
        { nonce: identity.nonce, ok: true, permissionPreexisting: false },
        identity.nonce,
      ),
    ).toEqual({ nonce: identity.nonce, ok: true, permissionPreexisting: false });
    expect(validateRequestWebImportPermissionResponse({ granted: true, ok: true })).toEqual({
      granted: true,
      ok: true,
    });
    expect(
      validateRequestWebImportPermissionResponse({ error: "lease-expired", ok: false }),
    ).toEqual({ error: "lease-expired", ok: false });
    expect(validateReleaseWebImportPermissionResponse({ ok: true, released: true })).toEqual({
      ok: true,
      released: true,
    });
    expect(
      validateRegisterWebImportPermissionLeaseResponse(
        { nonce: "other", ok: true, permissionPreexisting: false },
        identity.nonce,
      ),
    ).toBeUndefined();
    expect(
      validateRequestWebImportPermissionResponse({ granted: true, ok: true, secret: "leak" }),
    ).toBeUndefined();
  });
});
