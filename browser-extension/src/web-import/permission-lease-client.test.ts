// SPDX-License-Identifier: Apache-2.0
import type { Browser } from "wxt/browser";
import { describe, expect, it, vi } from "vitest";

import {
  PERMISSION_LEASE_HEARTBEAT_MS,
  PERMISSION_LEASE_MAX_LIFETIME_MS,
  disposeWebImportPermissionLeaseClient,
  registerWebImportPermissionLeaseClient,
  releaseWebImportPermission,
  requestWebImportPermission,
} from "./permission-lease-client";
import {
  KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
  REGISTER_WEB_IMPORT_PERMISSION_LEASE,
  RELEASE_WEB_IMPORT_PERMISSION,
  REQUEST_WEB_IMPORT_PERMISSION,
  WEB_IMPORT_PERMISSION_LEASE_PORT,
  type WebImportPermissionLeaseIdentity,
} from "./permission-lease-protocol";

const identity: WebImportPermissionLeaseIdentity = Object.freeze({
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  permissionPattern: "https://cdn.example.net/*",
  windowId: 7,
});

function portFixture() {
  const messageListeners = new Set<(message: unknown, port: Browser.runtime.Port) => void>();
  const disconnectListeners = new Set<(port: Browser.runtime.Port) => void>();
  const port = {
    disconnect: vi.fn(),
    name: WEB_IMPORT_PERMISSION_LEASE_PORT,
    onDisconnect: {
      addListener: (listener: (port: Browser.runtime.Port) => void) =>
        disconnectListeners.add(listener),
      hasListener: (listener: (port: Browser.runtime.Port) => void) =>
        disconnectListeners.has(listener),
      hasListeners: () => disconnectListeners.size > 0,
      removeListener: (listener: (port: Browser.runtime.Port) => void) =>
        disconnectListeners.delete(listener),
    },
    onMessage: {
      addListener: (listener: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.add(listener),
      hasListener: (listener: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.has(listener),
      hasListeners: () => messageListeners.size > 0,
      removeListener: (listener: (message: unknown, port: Browser.runtime.Port) => void) =>
        messageListeners.delete(listener),
    },
    postMessage: vi.fn(),
  } as unknown as Browser.runtime.Port;
  return {
    emitDisconnect() {
      for (const listener of disconnectListeners) listener(port);
    },
    emitMessage(message: unknown) {
      for (const listener of messageListeners) listener(message, port);
    },
    port,
  };
}

describe("web-import permission lease client", () => {
  it("keeps a Port only for a permission managed by this import", async () => {
    const test = portFixture();
    const registration = registerWebImportPermissionLeaseClient(
      (name) => {
        expect(name).toBe(WEB_IMPORT_PERMISSION_LEASE_PORT);
        return test.port;
      },
      identity,
      vi.fn(),
    );
    expect(test.port.postMessage).toHaveBeenCalledWith({
      ...identity,
      type: REGISTER_WEB_IMPORT_PERMISSION_LEASE,
    });
    test.emitMessage({ nonce: identity.nonce, ok: true, permissionPreexisting: false });

    const lease = await registration;
    expect(lease).toMatchObject({ identity, permissionPreexisting: false });
    disposeWebImportPermissionLeaseClient(lease);
    expect(test.port.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects immediately when the exact-origin permission predates the import", async () => {
    const test = portFixture();
    const registration = registerWebImportPermissionLeaseClient(() => test.port, identity, vi.fn());
    test.emitMessage({ nonce: identity.nonce, ok: true, permissionPreexisting: true });

    await expect(registration).resolves.toMatchObject({ identity, permissionPreexisting: true });
    expect(test.port.disconnect).toHaveBeenCalledOnce();
  });

  it("reports an unexpected background disconnect only while the lease is active", async () => {
    const test = portFixture();
    const disconnected = vi.fn();
    const registration = registerWebImportPermissionLeaseClient(
      () => test.port,
      identity,
      disconnected,
    );
    test.emitMessage({ nonce: identity.nonce, ok: true, permissionPreexisting: false });
    const lease = await registration;

    test.emitDisconnect();
    expect(disconnected).toHaveBeenCalledOnce();
    lease.close();
    test.emitDisconnect();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("keeps an active lease alive for a bounded period", async () => {
    vi.useFakeTimers();
    try {
      const test = portFixture();
      const expired = vi.fn();
      const registration = registerWebImportPermissionLeaseClient(
        () => test.port,
        identity,
        expired,
      );
      test.emitMessage({ nonce: identity.nonce, ok: true, permissionPreexisting: false });
      await registration;

      vi.advanceTimersByTime(PERMISSION_LEASE_HEARTBEAT_MS);
      expect(test.port.postMessage).toHaveBeenLastCalledWith({
        ...identity,
        type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
      });
      expect(expired).not.toHaveBeenCalled();

      vi.advanceTimersByTime(PERMISSION_LEASE_MAX_LIFETIME_MS);
      expect(test.port.disconnect).toHaveBeenCalledOnce();
      expect(expired).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends exact request and release messages and rejects malformed responses", async () => {
    const sendRequest = vi.fn(async () => ({ granted: true, ok: true }));
    await expect(requestWebImportPermission(sendRequest, identity)).resolves.toEqual({
      granted: true,
      ok: true,
    });
    expect(sendRequest).toHaveBeenCalledWith({ ...identity, type: REQUEST_WEB_IMPORT_PERMISSION });

    const sendRelease = vi.fn(async () => ({ ok: true, released: true }));
    await expect(releaseWebImportPermission(sendRelease, identity)).resolves.toEqual({
      ok: true,
      released: true,
    });
    expect(sendRelease).toHaveBeenCalledWith({ ...identity, type: RELEASE_WEB_IMPORT_PERMISSION });

    await expect(
      requestWebImportPermission(
        async () => ({ ok: true, sourceUrl: "https://private.invalid" }),
        identity,
      ),
    ).rejects.toThrow("Invalid temporary permission request response");
  });
});
