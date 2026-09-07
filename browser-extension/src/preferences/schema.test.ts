// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTENSION_PREFERENCES,
  systemDefaultPreferences,
  validateExtensionPreferences,
} from "./schema";

describe("extension preference schema", () => {
  it("normalizes format-specific settings without accepting content fields", () => {
    const value = validateExtensionPreferences({
      ...DEFAULT_EXTENSION_PREFERENCES,
      jpegBackground: "#AABBCC",
      lossless: true,
      outputFormat: "jpeg",
    });

    expect(value).toEqual({
      ...DEFAULT_EXTENSION_PREFERENCES,
      jpegBackground: "#aabbcc",
      lossless: false,
      outputFormat: "jpeg",
    });
    expect(value).not.toHaveProperty("files");
    expect(value).not.toHaveProperty("history");
  });

  it("rejects malformed, oversized, and out-of-budget settings", () => {
    expect(validateExtensionPreferences(null)).toBeUndefined();
    expect(
      validateExtensionPreferences({ ...DEFAULT_EXTENSION_PREFERENCES, schemaVersion: 2 }),
    ).toBeUndefined();
    expect(
      validateExtensionPreferences({
        ...DEFAULT_EXTENSION_PREFERENCES,
        resizeHeight: 65_535,
        resizeMode: "custom",
        resizeWidth: 65_535,
      }),
    ).toBeUndefined();
    expect(
      validateExtensionPreferences({
        ...DEFAULT_EXTENSION_PREFERENCES,
        pdfPageRange: "1".repeat(513),
      }),
    ).toBeUndefined();
  });

  it("derives only locale and theme from system preferences", () => {
    expect(systemDefaultPreferences(["fr", "zh-Hans"], true)).toMatchObject({
      locale: "zh",
      outputFormat: "webp",
      theme: "dark",
    });
  });
});
