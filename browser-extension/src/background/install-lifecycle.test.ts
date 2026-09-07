// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";

import { runExtensionInstallLifecycle } from "./install-lifecycle";

function fixture() {
  return {
    clearOwnedTransientSessionState: vi.fn(async () => undefined),
    installContextMenu: vi.fn(async () => undefined),
    migratePreferences: vi.fn(async () => undefined),
    restrictLocalStorage: vi.fn(async () => undefined),
  };
}

describe("extension install lifecycle", () => {
  it("clears owned transient state when the extension version updates", async () => {
    const tasks = fixture();
    await runExtensionInstallLifecycle("update", tasks);

    expect(tasks.restrictLocalStorage).toHaveBeenCalledOnce();
    expect(tasks.installContextMenu).toHaveBeenCalledOnce();
    expect(tasks.clearOwnedTransientSessionState).toHaveBeenCalledOnce();
    expect(tasks.migratePreferences).toHaveBeenCalledOnce();
  });

  it.each(["install", "chrome_update", "shared_module_update"])(
    "does not clear a live session for %s",
    async (reason) => {
      const tasks = fixture();
      await runExtensionInstallLifecycle(reason, tasks);
      expect(tasks.clearOwnedTransientSessionState).not.toHaveBeenCalled();
      expect(tasks.migratePreferences).not.toHaveBeenCalled();
    },
  );

  it("surfaces a migration failure after starting every update task", async () => {
    const tasks = fixture();
    tasks.migratePreferences.mockRejectedValueOnce(new Error("migration failed"));

    await expect(runExtensionInstallLifecycle("update", tasks)).rejects.toThrow("migration failed");
    expect(tasks.restrictLocalStorage).toHaveBeenCalledOnce();
    expect(tasks.installContextMenu).toHaveBeenCalledOnce();
    expect(tasks.clearOwnedTransientSessionState).toHaveBeenCalledOnce();
  });
});
