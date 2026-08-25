// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  addPaths,
  addDemoItems,
  appUpdate,
  capabilities,
  checkForAppUpdate,
  clearQueue,
  effectiveQualityFor,
  fmtSize,
  formatFromExt,
  formatImportSummary,
  formatLabel,
  hasTemporaryQueuedInput,
  needsOutputDirectoryForBatch,
  needsOutputDirectoryGrant,
  normalizeOutputSuffixInput,
  normalizePersistedOutputSuffixSettings,
  outputSuffixForRequest,
  qualityFloorFor,
  queue,
  scopedDialogFileAccessMode,
  setImportCommandError,
  setImportMessage,
  settings,
  ui,
} from "../src/lib/state.svelte";
import { initI18n, setAppLocale } from "../src/lib/i18n";

describe("state helpers", () => {
  beforeEach(() => {
    clearQueue();
    capabilities.readable = ["jpeg", "png", "webp", "avif"];
    capabilities.writable = ["jpeg", "png", "webp", "avif"];
    capabilities.lossless = ["png", "webp"];
    capabilities.heic = false;
    capabilities.codecProviders = [];
    settings.quality = 80;
    settings.lossless = false;
    settings.jpegQualityFloor = 30;
    settings.webpQualityFloor = 30;
    settings.avifQualityFloor = 30;
    settings.outputSuffixEnabled = true;
    settings.outputSuffix = "_done";
    settings.fileNameTemplate = "%name%";
  });

  it("maps extensions and labels through the capability model", () => {
    expect(formatFromExt("JPG")).toBe("jpeg");
    expect(formatFromExt("unknown")).toBeNull();
    expect(formatLabel("webp")).toBe("WebP");
  });

  it("requires a fresh output-folder grant for each macOS app session", () => {
    expect(needsOutputDirectoryGrant(true, true, false, false)).toBe(true);
    expect(needsOutputDirectoryGrant(true, true, true, false)).toBe(true);
    expect(needsOutputDirectoryGrant(true, true, true, true)).toBe(false);
  });

  it("requires a selected output folder for Flatpak portal writes", () => {
    expect(needsOutputDirectoryGrant(true, false, false, false)).toBe(true);
    expect(needsOutputDirectoryGrant(true, false, true, false)).toBe(false);
    expect(needsOutputDirectoryGrant(false, false, false, false)).toBe(false);
  });

  it("requires an explicit output folder for temporary clipboard imports on every platform", () => {
    expect(needsOutputDirectoryForBatch(false, false, false, false, true)).toBe(true);
    expect(needsOutputDirectoryForBatch(false, false, true, false, true)).toBe(false);
    expect(needsOutputDirectoryForBatch(true, false, true, false, true)).toBe(false);
    expect(needsOutputDirectoryForBatch(true, true, true, false, false)).toBe(true);
    expect(hasTemporaryQueuedInput([{ temporary: true, status: "pending" }])).toBe(true);
    expect(hasTemporaryQueuedInput([{ temporary: true, status: "done" }])).toBe(false);
    expect(hasTemporaryQueuedInput([{ temporary: false, status: "pending" }])).toBe(false);
  });

  it("normalizes custom suffixes before they reach the conversion command", () => {
    expect(normalizeOutputSuffixInput(" _done%100 ")).toEqual({
      value: "_done%100",
      adjusted: true,
    });
    expect(normalizeOutputSuffixInput("_done/path")).toEqual({
      value: "_done_path",
      adjusted: true,
    });
    expect(normalizeOutputSuffixInput("...")).toEqual({ value: "...", adjusted: false });

    const emojiSuffix = normalizeOutputSuffixInput("😀".repeat(48));
    expect(Array.from(emojiSuffix.value).length).toBeLessThanOrEqual(48);
    expect(new TextEncoder().encode(emojiSuffix.value).length).toBeLessThanOrEqual(128);
    expect(emojiSuffix.adjusted).toBe(true);
  });

  it("keeps existing template-only settings unchanged until suffixes are explicitly enabled", () => {
    expect(normalizePersistedOutputSuffixSettings({}, true, "_done")).toEqual({
      outputSuffixEnabled: false,
      outputSuffix: "_done",
    });
    expect(
      normalizePersistedOutputSuffixSettings({ outputSuffixEnabled: false }, false, "_custom"),
    ).toEqual({
      outputSuffixEnabled: false,
      outputSuffix: "_custom",
    });
    expect(normalizePersistedOutputSuffixSettings(undefined, "invalid", "")).toEqual({
      outputSuffixEnabled: true,
      outputSuffix: "_done",
    });
  });

  it("sends a suffix only while the suffix switch is enabled", () => {
    expect(outputSuffixForRequest(true, "-min")).toBe("-min");
    expect(outputSuffixForRequest(false, "-min")).toBeNull();
  });

  it("keeps macOS file picker access security-scoped", () => {
    expect(scopedDialogFileAccessMode(true)).toBe("scoped");
    expect(scopedDialogFileAccessMode(false)).toBeUndefined();
  });

  it("adds readable paths and reports duplicates/skips", () => {
    const result = addPaths(["/tmp/a.png", "/tmp/a.png", "/tmp/readme.txt"]);

    expect(result).toEqual({ added: 1, duplicates: 1, skipped: 1 });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.name).toBe("a.png");
  });

  it("formats byte sizes for queue summaries", () => {
    expect(fmtSize(0)).toBe("0 B");
    expect(fmtSize(1536)).toBe("1.5 KB");
  });

  it("applies per-format quality floors only to lossy targets", () => {
    settings.quality = 18;
    settings.jpegQualityFloor = 65;
    settings.webpQualityFloor = 29;
    settings.avifQualityFloor = 45;

    expect(qualityFloorFor("jpeg")).toBe(65);
    expect(effectiveQualityFor("jpeg")).toBe(65);
    expect(effectiveQualityFor("webp")).toBe(18);
    expect(effectiveQualityFor("avif")).toBe(45);
    expect(effectiveQualityFor("png")).toBe(18);

    settings.lossless = true;
    expect(effectiveQualityFor("webp")).toBe(18);
  });

  it("re-localizes an active batch progress stage when the locale changes", async () => {
    await initI18n("zh-CN");
    addPaths(["/tmp/a.png"]);
    const item = queue[0];
    expect(item).toBeDefined();
    if (!item) return;
    item.status = "running";
    item.progressStage = "readingAndConverting";
    item.detail = "读取并转换";

    setAppLocale("en-US");
    expect(item.detail).toBe("Reading and converting");

    setAppLocale("zh-CN");
    expect(item.detail).toBe("读取并转换");
  });

  it("re-localizes persisted queue detail messages when the locale changes", async () => {
    await initI18n("zh-CN");
    addDemoItems();
    expect(queue[0]?.detail).toBe("网页预览示例");

    setAppLocale("en-US");
    expect(queue[0]?.detail).toBe("Web preview sample");

    setAppLocale("zh-CN");
    expect(queue[0]?.detail).toBe("网页预览示例");
  });

  it("localizes language-neutral import scan limit reasons", async () => {
    const scan = {
      files: [],
      skipped: 0,
      errors: [],
      truncated: true,
      cancelled: false,
      limitReason: "entryCount" as const,
    };

    await initI18n("en-US");
    expect(formatImportSummary({ added: 0, duplicates: 0, skipped: 0 }, scan)).toBe(
      "Scan entry limit reached",
    );

    setAppLocale("zh-CN");
    expect(formatImportSummary({ added: 0, duplicates: 0, skipped: 0 }, scan)).toBe(
      "扫描条目达到上限",
    );
  });

  it("re-localizes persistent import and wrapped error messages", async () => {
    await initI18n("zh-CN");
    setImportMessage("state.importCancelled");
    expect(ui.importMessage).toBe("已取消导入扫描");

    setAppLocale("en-US");
    expect(ui.importMessage).toBe("Import scan canceled");

    setImportCommandError(
      {
        code: "unsupportedFormat",
        params: { format: "tiff" },
        detail: null,
      },
      "dropzone.errorDropHint",
    );
    expect(ui.importMessage).toContain("Unsupported format: tiff");

    setAppLocale("zh-CN");
    expect(ui.importMessage).toContain("不支持的格式：tiff");
  });

  it("re-localizes a persistent updater result", async () => {
    await initI18n("zh-CN");
    await checkForAppUpdate();
    expect(appUpdate.message).toBe("网页预览不连接桌面更新通道");

    setAppLocale("en-US");
    expect(appUpdate.message).toBe(
      "The web preview is not connected to the desktop update channel",
    );
  });
});
