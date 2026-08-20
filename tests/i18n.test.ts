// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { enUS } from "../src/lib/i18n/messages/en-US";
import { zhCN } from "../src/lib/i18n/messages/zh-CN";
import { initI18n, normalizeLocale, setAppLocale } from "../src/lib/i18n";

const tauriMocks = vi.hoisted(() => ({
  active: false,
  setTitle: vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriMocks.active,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: tauriMocks.setTitle }),
}));

afterEach(async () => {
  tauriMocks.active = false;
  tauriMocks.setTitle.mockClear();
  await initI18n("en-US");
});

function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function messageValues(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") {
    return [[prefix, value]];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    messageValues(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z][\w]*)/g)].map((match) => match[1]).sort();
}

describe("i18n dictionaries", () => {
  it("keeps zh-CN and en-US key sets identical", () => {
    const zh = keyPaths(zhCN).sort();
    const en = keyPaths(enUS).sort();
    expect(en).toEqual(zh);
  });

  it("keeps ICU placeholders identical across locales", () => {
    const zh = new Map(messageValues(zhCN));
    const en = new Map(messageValues(enUS));

    for (const [key, enMessage] of en) {
      expect(placeholders(zh.get(key) ?? ""), key).toEqual(placeholders(enMessage));
    }
  });

  it("normalizes Chinese locales to zh-CN", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale(null)).toBe("en-US");
  });

  it("keeps the page metadata in sync with the selected locale", async () => {
    await initI18n("zh-CN");
    expect(document.title).toBe("ImgConvert · 图片批量转换");
    expect(document.documentElement.lang).toBe("zh-CN");

    setAppLocale("en-US");
    expect(document.title).toBe("ImgConvert · Batch Image Converter");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("updates the native Tauri window title", async () => {
    tauriMocks.active = true;

    await initI18n("zh-CN");
    expect(tauriMocks.setTitle).toHaveBeenLastCalledWith("ImgConvert · 图片批量转换");

    setAppLocale("en-US");
    await vi.waitFor(() => {
      expect(tauriMocks.setTitle).toHaveBeenLastCalledWith("ImgConvert · Batch Image Converter");
    });
  });
});
