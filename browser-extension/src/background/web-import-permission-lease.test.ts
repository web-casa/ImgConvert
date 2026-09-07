// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import type { WebImportPermissionLeaseIdentity } from "../web-import/permission-lease-protocol";
import {
  cleanupOrphanedWebImportPermissionLeases,
  markWebImportPermissionLeaseGranted,
  registerWebImportPermissionLease,
  releaseWebImportPermissionLease,
  webImportPermissionLeaseStorageKey,
} from "./web-import-permission-lease";

const firstIdentity: WebImportPermissionLeaseIdentity = Object.freeze({
  nonce: "123e4567-e89b-42d3-a456-426614174000",
  permissionPattern: "https://cdn.example.net/*",
  windowId: 7,
});
const secondIdentity: WebImportPermissionLeaseIdentity = Object.freeze({
  nonce: "123e4567-e89b-42d3-a456-426614174001",
  permissionPattern: "https://cdn.example.net/*",
  windowId: 9,
});

function fixture(initial: Record<string, unknown> = {}, granted = false) {
  const values: Record<string, unknown> = { ...initial };
  let permissionGranted = granted;
  const session = {
    get: vi.fn(async (keys: null | string) =>
      keys === null ? { ...values } : keys in values ? { [keys]: values[keys] } : {},
    ),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
  };
  const permissions = {
    contains: vi.fn(async () => permissionGranted),
    remove: vi.fn(async () => {
      const removed = permissionGranted;
      permissionGranted = false;
      return removed;
    }),
  };
  return {
    grantPermission() {
      permissionGranted = true;
    },
    hasPermission() {
      return permissionGranted;
    },
    permissions,
    session,
    values,
  };
}

describe("web-import permission leases", () => {
  it("registers, marks, and releases a newly granted exact-origin permission", async () => {
    const test = fixture();
    await expect(
      registerWebImportPermissionLease(test.session, test.permissions, firstIdentity, 10),
    ).resolves.toEqual({ permissionPreexisting: false });
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toMatchObject({
      createdAt: 10,
      state: "prepared",
    });

    test.grantPermission();
    await expect(
      markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(true);
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toMatchObject({
      state: "granted",
    });

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(true);
    expect(test.hasPermission()).toBe(false);
    expect(test.values).toEqual({});
  });

  it("never leases or removes a permission that predates the import", async () => {
    const test = fixture({}, true);
    await expect(
      registerWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).resolves.toEqual({ permissionPreexisting: true });
    expect(test.values).toEqual({});
    expect(test.permissions.remove).not.toHaveBeenCalled();
  });

  it("removes a late grant after the owning page already released its prepared lease", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(true);

    test.grantPermission();
    await expect(
      markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(false);
    expect(test.hasPermission()).toBe(false);
    expect(test.values).toEqual({});
  });

  it("persists recovery state when a late grant cannot be removed immediately", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    await releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    test.permissions.remove.mockResolvedValueOnce(false);

    await expect(
      markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(false);
    expect(test.hasPermission()).toBe(true);
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toMatchObject({
      state: "granted",
    });

    await expect(
      cleanupOrphanedWebImportPermissionLeases(test.session, test.permissions),
    ).resolves.toEqual({ cleaned: 1, failed: 0, invalid: 0 });
    expect(test.hasPermission()).toBe(false);
    expect(test.values).toEqual({});
  });

  it("retains a shared temporary permission until the final granted lease releases it", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity);
    await expect(
      registerWebImportPermissionLease(test.session, test.permissions, secondIdentity),
    ).resolves.toEqual({ permissionPreexisting: false });
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, secondIdentity);

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(true);
    expect(test.hasPermission()).toBe(true);
    expect(test.permissions.remove).not.toHaveBeenCalled();

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, secondIdentity),
    ).resolves.toBe(true);
    expect(test.hasPermission()).toBe(false);
  });

  it("retains a shared permission while another same-origin lease is still prepared", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity);
    await registerWebImportPermissionLease(test.session, test.permissions, secondIdentity);

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).resolves.toBe(true);
    expect(test.hasPermission()).toBe(true);
    expect(test.values[webImportPermissionLeaseStorageKey(secondIdentity.nonce)]).toMatchObject({
      state: "prepared",
    });

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, secondIdentity),
    ).resolves.toBe(true);
    expect(test.hasPermission()).toBe(false);
  });

  it("cleans orphaned leases on worker startup without clearing unrelated local data", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    test.values["imgconvert.permissionLease.not-a-nonce"] = { permissionPattern: "https://*/*" };
    test.values["unrelated.session"] = "keep";

    await expect(
      cleanupOrphanedWebImportPermissionLeases(test.session, test.permissions),
    ).resolves.toEqual({ cleaned: 1, failed: 0, invalid: 1 });
    expect(test.values).toEqual({ "unrelated.session": "keep" });
    expect(test.hasPermission()).toBe(false);
  });

  it("keeps a valid orphan record when browser permission removal fails", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    test.permissions.remove.mockRejectedValueOnce(new Error("temporary browser failure"));

    await expect(
      cleanupOrphanedWebImportPermissionLeases(test.session, test.permissions),
    ).resolves.toEqual({ cleaned: 0, failed: 1, invalid: 0 });
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toBeDefined();
    expect(test.hasPermission()).toBe(true);
  });

  it("keeps recovery state if storage cleanup fails after permission removal", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity);
    test.grantPermission();
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity);
    test.session.remove.mockRejectedValueOnce(new Error("temporary storage failure"));

    await expect(
      releaseWebImportPermissionLease(test.session, test.permissions, firstIdentity),
    ).rejects.toThrow("temporary storage failure");
    expect(test.hasPermission()).toBe(false);
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toBeDefined();

    await expect(
      cleanupOrphanedWebImportPermissionLeases(test.session, test.permissions),
    ).resolves.toEqual({ cleaned: 1, failed: 0, invalid: 0 });
    expect(test.values).toEqual({});
  });

  it("does not revoke a new granted lease created after startup cleanup took its snapshot", async () => {
    const test = fixture();
    await registerWebImportPermissionLease(test.session, test.permissions, firstIdentity, 10);
    test.grantPermission();
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, firstIdentity);

    const originalGet = test.session.get.getMockImplementation();
    let releaseSnapshot: (() => void) | undefined;
    let snapshotCaptured: (() => void) | undefined;
    const captured = new Promise<void>((resolve) => {
      snapshotCaptured = resolve;
    });
    const waitForRegistration = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    test.session.get.mockImplementationOnce(async (keys: null | string) => {
      const snapshot = await originalGet?.(keys);
      snapshotCaptured?.();
      await waitForRegistration;
      return snapshot ?? {};
    });

    const cleanup = cleanupOrphanedWebImportPermissionLeases(test.session, test.permissions);
    await captured;
    await registerWebImportPermissionLease(test.session, test.permissions, secondIdentity, 20);
    await markWebImportPermissionLeaseGranted(test.session, test.permissions, secondIdentity);
    releaseSnapshot?.();

    await expect(cleanup).resolves.toEqual({ cleaned: 1, failed: 0, invalid: 0 });
    expect(test.hasPermission()).toBe(true);
    expect(test.values[webImportPermissionLeaseStorageKey(firstIdentity.nonce)]).toBeUndefined();
    expect(test.values[webImportPermissionLeaseStorageKey(secondIdentity.nonce)]).toMatchObject({
      state: "granted",
    });
  });
});
