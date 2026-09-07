// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import { DEFAULT_EXTENSION_PREFERENCES } from "./schema";
import {
  EXTENSION_PREFERENCES_STORAGE_VERSION,
  isCanonicalStoredExtensionPreferences,
  migrateExtensionPreferencesToV2,
} from "./migration";

describe("extension preference migration", () => {
  it("canonicalizes the established v1 payload and drops content-shaped fields", () => {
    const migrated = migrateExtensionPreferencesToV2({
      ...DEFAULT_EXTENSION_PREFERENCES,
      files: [{ bytes: "data:image/png;base64,private", name: "private.png" }],
      history: ["private.png"],
      jpegBackground: "#AABBCC",
      locale: "zh",
      outputFormat: "jpeg",
      quality: 73,
      theme: "dark",
    });

    expect(EXTENSION_PREFERENCES_STORAGE_VERSION).toBe(2);
    expect(migrated).toEqual({
      ...DEFAULT_EXTENSION_PREFERENCES,
      jpegBackground: "#aabbcc",
      locale: "zh",
      outputFormat: "jpeg",
      quality: 73,
      theme: "dark",
    });
    expect(migrated).not.toHaveProperty("files");
    expect(migrated).not.toHaveProperty("history");
  });

  it("fails closed to content-free defaults for malformed legacy data", () => {
    const migrated = migrateExtensionPreferencesToV2({
      fileName: "private.png",
      schemaVersion: 1,
      sourceUrl: "https://example.test/private.png",
    });

    expect(migrated).toEqual(DEFAULT_EXTENSION_PREFERENCES);
    expect(JSON.stringify(migrated)).not.toContain("private");
    expect(Object.isFrozen(migrated)).toBe(true);
  });

  it("detects normalized values and every extra durable field", () => {
    expect(
      isCanonicalStoredExtensionPreferences(
        { ...DEFAULT_EXTENSION_PREFERENCES },
        DEFAULT_EXTENSION_PREFERENCES,
      ),
    ).toBe(true);
    expect(
      isCanonicalStoredExtensionPreferences(
        { ...DEFAULT_EXTENSION_PREFERENCES, history: [] },
        DEFAULT_EXTENSION_PREFERENCES,
      ),
    ).toBe(false);
    expect(
      isCanonicalStoredExtensionPreferences(
        { ...DEFAULT_EXTENSION_PREFERENCES, jpegBackground: "#FFFFFF" },
        DEFAULT_EXTENSION_PREFERENCES,
      ),
    ).toBe(false);
  });
});
