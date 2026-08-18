// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { enUS } from "../src/lib/i18n/messages/en-US";
import { zhCN } from "../src/lib/i18n/messages/zh-CN";
import { normalizeLocale } from "../src/lib/i18n";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n dictionaries", () => {
  it("keeps zh-CN and en-US key sets identical", () => {
    const zh = keyPaths(zhCN).sort();
    const en = keyPaths(enUS).sort();
    expect(en).toEqual(zh);
  });

  it("normalizes Chinese locales to zh-CN", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale(null)).toBe("en-US");
  });
});
