// SPDX-License-Identifier: Apache-2.0
import type { Browser } from "wxt/browser";
import { describe, expect, it, vi } from "vitest";

import {
  KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
  REGISTER_WEB_IMPORT_PERMISSION_LEASE,
  type WebImportPermissionLeaseIdentity,
} from "../web-import/permission-lease-protocol";
import {
  attachWebImportPermissionLeasePort,
  createWebImportPermissionLeaseActivity,
  requestWebImportPermissionFromUserGesture,
} from "./web-import-permission-service";

const identity: WebImportPermissionLeaseIdentity = Object.freeze({
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  permissionPattern: "https://cdn.example.net/*",
  windowId: 7,
});

function storageAndPermissions() {
  const values: Record<string, unknown> = {};
  let granted = false;
  let requestImplementation = async () => {
    granted = true;
    return true;
  };
  return {
    dependencies: {
      activity: createWebImportPermissionLeaseActivity(),
      now: () => 10,
      permissions: {
        contains: vi.fn(async () => granted),
        remove: vi.fn(async () => {
          const removed = granted;
          granted = false;
          return removed;
        }),
        request: vi.fn(() => requestImplementation()),
      },
      recover: vi.fn(async () => {}),
      resolveWindowId: vi.fn(async (): Promise<number | undefined> => identity.windowId),
      storage: {
        get: vi.fn(async (keys: null | string) =>
          keys === null ? { ...values } : keys in values ? { [keys]: values[keys] } : {},
        ),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(values, items);
        }),
      },
    },
    grant() {
      granted = true;
    },
    hasPermission() {
      return granted;
    },
    setRequestImplementation(implementation: () => Promise<boolean>) {
      requestImplementation = implementation;
    },
    values,
  };
}

function portFixture() {
  const messageListeners = new Set<(message: unknown, port: Browser.runtime.Port) => void>();
  const disconnectListeners = new Set<(port: Browser.runtime.Port) => void>();
  const posted: unknown[] = [];
  const port = {
    disconnect: vi.fn(),
    name: "imgconvert.webImportPermissionLease",
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
    postMessage: vi.fn((message: unknown) => posted.push(message)),
  } as unknown as Browser.runtime.Port;
  return {
    disconnect() {
      for (const listener of disconnectListeners) listener(port);
    },
    message(message: unknown) {
      for (const listener of messageListeners) listener(message, port);
    },
    port,
    posted,
  };
}

describe("background web-import permission service", () => {
  it("rejects a lease for a different browser-authenticated window before persistence", async () => {
    const test = storageAndPermissions();
    test.dependencies.resolveWindowId.mockResolvedValueOnce(8);
    const port = portFixture();
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    expect(port.posted[0]).toEqual({
      error: "registration-failed",
      nonce: identity.nonce,
      ok: false,
    });
    expect(test.dependencies.storage.set).not.toHaveBeenCalled();
    expect(test.dependencies.permissions.request).not.toHaveBeenCalled();
  });

  it("binds permission requests to the registered document without awaiting before the prompt", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    port.port.sender = { documentId: "document-1" };
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    await expect(
      requestWebImportPermissionFromUserGesture(test.dependencies, identity, "document-2"),
    ).resolves.toEqual({ error: "lease-expired", ok: false });
    expect(test.dependencies.permissions.request).not.toHaveBeenCalled();
    const request = requestWebImportPermissionFromUserGesture(
      test.dependencies,
      identity,
      "document-1",
    );
    expect(test.dependencies.permissions.request).toHaveBeenCalledOnce();
    await expect(request).resolves.toEqual({ granted: true, ok: true });
  });

  it("rejects a request that is not bound to a live registered Port", async () => {
    const test = storageAndPermissions();

    const responsePromise = requestWebImportPermissionFromUserGesture(test.dependencies, identity);

    expect(test.dependencies.permissions.request).not.toHaveBeenCalled();
    await expect(responsePromise).resolves.toEqual({ error: "lease-expired", ok: false });
  });

  it("accepts only exact keep-alive messages after registration", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));

    port.message({ ...identity, type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE });
    expect(port.port.disconnect).not.toHaveBeenCalled();
    port.message({
      ...identity,
      nonce: "123e4567-e89b-42d3-a456-426614174999",
      type: KEEP_ALIVE_WEB_IMPORT_PERMISSION_LEASE,
    });
    expect(port.port.disconnect).toHaveBeenCalledOnce();
  });

  it("waits for startup recovery before registering a lease", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    let finishRecovery: (() => void) | undefined;
    test.dependencies.recover.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRecovery = resolve;
        }),
    );
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });

    expect(port.posted).toEqual([]);
    expect(test.dependencies.storage.set).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(finishRecovery).toBeTypeOf("function"));
    finishRecovery?.();

    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    expect(port.posted[0]).toEqual({
      nonce: identity.nonce,
      ok: true,
      permissionPreexisting: false,
    });
  });

  it("fails closed when startup recovery cannot complete", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    test.dependencies.recover.mockRejectedValueOnce(new Error("temporary storage failure"));
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });

    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    expect(port.posted[0]).toEqual({
      error: "registration-failed",
      nonce: identity.nonce,
      ok: false,
    });
    expect(test.dependencies.permissions.request).not.toHaveBeenCalled();
    expect(test.values).toEqual({});
  });

  it("keeps the user-gesture permission request synchronous and cleans on Port disconnect", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));

    const responsePromise = requestWebImportPermissionFromUserGesture(test.dependencies, identity);
    expect(test.dependencies.permissions.request).toHaveBeenCalledOnce();
    await expect(responsePromise).resolves.toEqual({ granted: true, ok: true });
    expect(test.hasPermission()).toBe(true);

    port.disconnect();
    await vi.waitFor(() => expect(test.hasPermission()).toBe(false));
    expect(test.values).toEqual({});
  });

  it("revokes a permission that resolves after its UI Port has disconnected", async () => {
    const test = storageAndPermissions();
    const port = portFixture();
    let resolveRequest: ((granted: boolean) => void) | undefined;
    test.setRequestImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    attachWebImportPermissionLeasePort(port.port, test.dependencies);
    port.message({ ...identity, type: REGISTER_WEB_IMPORT_PERMISSION_LEASE });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));

    const responsePromise = requestWebImportPermissionFromUserGesture(test.dependencies, identity);
    port.disconnect();
    await vi.waitFor(() => expect(test.values).toEqual({}));
    test.grant();
    resolveRequest?.(true);

    await expect(responsePromise).resolves.toEqual({ error: "lease-expired", ok: false });
    expect(test.hasPermission()).toBe(false);
  });
});
