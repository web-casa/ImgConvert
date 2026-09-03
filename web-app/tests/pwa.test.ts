import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WEB_CONVERSION_PREFERENCES,
  WEB_CONVERSION_PREFERENCES_KEY,
  WEB_LOCALE_PREFERENCE_KEY,
  WEB_THEME_PREFERENCE_KEY,
  clearWebPreferences,
  loadWebConversionPreferences,
  saveWebConversionPreferences,
  validateWebConversionPreferences,
} from "../src/lib/preferences";
import { clearImgConvertOfflineCaches, isImgConvertCacheName } from "../src/lib/pwa";

describe("Web conversion preferences", () => {
  it("round-trips only bounded non-content settings", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const preferences = {
      ...DEFAULT_WEB_CONVERSION_PREFERENCES,
      jpegBackground: "#F8F5ED",
      outputFormat: "avif" as const,
      pdfDpi: 144,
      pdfPageRange: "1-3,5",
      quality: 74,
      resizeHeight: 720,
      resizeMode: "custom" as const,
      resizeWidth: 1280,
    };

    saveWebConversionPreferences(storage, preferences);
    expect(loadWebConversionPreferences(storage)).toEqual({
      ...preferences,
      jpegBackground: "#f8f5ed",
    });
    const serialized = values.get(WEB_CONVERSION_PREFERENCES_KEY) ?? "";
    expect(serialized).not.toMatch(/(?:blob:|filename|source|result)/iu);
  });

  it("fails closed for malformed, oversized, or unsafe values", () => {
    const invalid = {
      ...DEFAULT_WEB_CONVERSION_PREFERENCES,
      resizeHeight: 8000,
      resizeMode: "custom",
      resizeWidth: 8000,
    };
    expect(validateWebConversionPreferences(invalid)).toBeUndefined();
    expect(loadWebConversionPreferences({ getItem: () => JSON.stringify(invalid) })).toBe(
      DEFAULT_WEB_CONVERSION_PREFERENCES,
    );
    expect(loadWebConversionPreferences({ getItem: () => "x".repeat(4097) })).toBe(
      DEFAULT_WEB_CONVERSION_PREFERENCES,
    );
    expect(
      loadWebConversionPreferences({
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      }),
    ).toBe(DEFAULT_WEB_CONVERSION_PREFERENCES);
  });

  it("clears conversion, locale, and theme keys without touching unrelated storage", () => {
    const removeItem = vi.fn();
    expect(clearWebPreferences({ removeItem, setItem: vi.fn() })).toBe(true);
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([
      WEB_CONVERSION_PREFERENCES_KEY,
      WEB_LOCALE_PREFERENCE_KEY,
      WEB_THEME_PREFERENCE_KEY,
    ]);
  });

  it("continues clearing remaining keys and reports a storage rejection", () => {
    const attempted: string[] = [];
    const storage = {
      removeItem(key: string) {
        attempted.push(key);
        if (key === WEB_LOCALE_PREFERENCE_KEY) throw new DOMException("blocked", "SecurityError");
      },
      setItem: vi.fn(),
    };

    expect(clearWebPreferences(storage)).toBe(false);
    expect(attempted).toEqual([
      WEB_CONVERSION_PREFERENCES_KEY,
      WEB_LOCALE_PREFERENCE_KEY,
      WEB_THEME_PREFERENCE_KEY,
    ]);
  });
});

describe("ImgConvert offline cache boundary", () => {
  it("deletes only ImgConvert Web cache names", async () => {
    const deleteCache = vi.fn(async (name: string) => name !== "imgconvert-web:missing");
    const cacheStorage = {
      delete: deleteCache,
      keys: async () => [
        "imgconvert-web:web-v1-protocol-1:build:shell",
        "another-product-cache",
        "imgconvert-web:missing",
      ],
    } as unknown as CacheStorage;

    await expect(clearImgConvertOfflineCaches(cacheStorage)).resolves.toBe(1);
    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([
      "imgconvert-web:web-v1-protocol-1:build:shell",
      "imgconvert-web:missing",
    ]);
    expect(isImgConvertCacheName("another-product-cache")).toBe(false);
  });
});
