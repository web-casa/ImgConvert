// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTENSION_PREFERENCES } from "./schema";

const storageFixture = vi.hoisted(() => ({
  getValue: vi.fn(async (): Promise<unknown> => null),
  migrate: vi.fn(async () => undefined),
  removeValue: vi.fn(async () => undefined),
  setValue: vi.fn(async (_value: unknown) => undefined),
}));

vi.mock("#imports", () => ({
  storage: {
    defineItem: vi.fn(() => storageFixture),
  },
}));

const { loadExtensionPreferences, migrateExtensionPreferencesStorage } = await import("./storage");

describe("extension preference storage", () => {
  beforeEach(() => {
    storageFixture.getValue.mockReset().mockResolvedValue(null);
    storageFixture.migrate.mockReset().mockResolvedValue(undefined);
    storageFixture.removeValue.mockReset().mockResolvedValue(undefined);
    storageFixture.setValue.mockReset().mockResolvedValue(undefined);
  });

  it("does not persist a first-run fallback", async () => {
    await expect(loadExtensionPreferences(DEFAULT_EXTENSION_PREFERENCES)).resolves.toEqual({
      persistent: true,
      preferences: DEFAULT_EXTENSION_PREFERENCES,
    });
    expect(storageFixture.setValue).not.toHaveBeenCalled();
  });

  it("physically replaces an existing non-canonical record", async () => {
    storageFixture.getValue.mockResolvedValue({
      ...DEFAULT_EXTENSION_PREFERENCES,
      history: ["private.png"],
      jpegBackground: "#AABBCC",
    });

    const loaded = await loadExtensionPreferences(DEFAULT_EXTENSION_PREFERENCES);
    expect(loaded.persistent).toBe(true);
    expect(loaded.preferences.jpegBackground).toBe("#aabbcc");
    expect(storageFixture.setValue).toHaveBeenCalledOnce();
    expect(storageFixture.setValue.mock.calls[0]?.[0]).not.toHaveProperty("history");
  });

  it("reports session-only state when canonical cleanup cannot be saved", async () => {
    storageFixture.getValue.mockResolvedValue({
      ...DEFAULT_EXTENSION_PREFERENCES,
      files: ["private.png"],
    });
    storageFixture.setValue.mockRejectedValueOnce(new Error("write failed"));

    await expect(loadExtensionPreferences(DEFAULT_EXTENSION_PREFERENCES)).resolves.toMatchObject({
      persistent: false,
      preferences: DEFAULT_EXTENSION_PREFERENCES,
    });
  });

  it("exposes the declarative migration for background lifecycle use", async () => {
    await migrateExtensionPreferencesStorage();
    expect(storageFixture.migrate).toHaveBeenCalledOnce();
  });
});
