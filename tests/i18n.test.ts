// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { enUS } from "../src/lib/i18n/messages/en-US";
import { zhCN } from "../src/lib/i18n/messages/zh-CN";
import { normalizeLocale, setAppLocale } from "../src/lib/i18n";

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
  await setAppLocale("en-US");
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

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".mjs", ".svelte", ".ts"].includes(extname(path)) ? [path] : [];
  });
}

function containsExactStringLiteral(corpus: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("([\"'`])" + escaped + "\\1").test(corpus);
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

  it("has no unreferenced translation keys outside audited dynamic namespaces", () => {
    const files = ["src", "tests", "e2e-desktop"]
      .flatMap(sourceFiles)
      .filter(
        (path) => !path.includes("/i18n/messages/") && path !== join("tests", "i18n.test.ts"),
      );
    const corpus = files.map((path) => readFileSync(path, "utf8")).join("\n");
    const expectedDynamicKeys = [
      "workflow.metadata.colorOnly",
      "workflow.metadata.colorOnlyDescription",
      "workflow.metadata.preserveAll",
      "workflow.metadata.preserveAllDescription",
      "workflow.metadata.stripAll",
      "workflow.metadata.stripAllDescription",
      "workflow.resizeModes.fit",
      "workflow.resizeModes.height",
      "workflow.resizeModes.longestEdge",
      "workflow.resizeModes.none",
      "workflow.resizeModes.percentage",
      "workflow.resizeModes.width",
    ];
    const unreferenced = keyPaths(enUS)
      .filter((key) => !containsExactStringLiteral(corpus, key))
      .sort();

    expect(unreferenced).toEqual(expectedDynamicKeys);
  });

  it("normalizes Chinese locales to zh-CN", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale(null)).toBe("en-US");
  });

  it("keeps the page metadata in sync with the selected locale", async () => {
    await setAppLocale("zh-CN");
    expect(document.title).toBe("ImgConvert · 图片与 PDF 批量转换");
    expect(document.documentElement.lang).toBe("zh-CN");

    await setAppLocale("en-US");
    expect(document.title).toBe("ImgConvert · Batch Image and PDF Converter");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("updates the native Tauri window title", async () => {
    tauriMocks.active = true;

    await setAppLocale("zh-CN");
    expect(tauriMocks.setTitle).toHaveBeenLastCalledWith("ImgConvert · 图片与 PDF 批量转换");

    await setAppLocale("en-US");
    expect(tauriMocks.setTitle).toHaveBeenLastCalledWith(
      "ImgConvert · Batch Image and PDF Converter",
    );
  });
});
