// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCommandError, parseCommandError } from "../src/lib/command-error";
import { initI18n } from "../src/lib/i18n";

afterEach(async () => {
  await initI18n("en-US");
  vi.restoreAllMocks();
});

describe("structured command errors", () => {
  it("formats a Tauri error payload with ICU parameters", async () => {
    await initI18n("en-US");

    expect(
      formatCommandError({
        code: "fileNotFound",
        params: { path: "/images/missing.png" },
        detail: null,
      }),
    ).toBe("File not found: /images/missing.png");
  });

  it("formats the same error in zh-CN without rendering its detail", async () => {
    await initI18n("zh-CN");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const message = formatCommandError({
      code: "unsupportedFormat",
      params: { format: "tiff" },
      detail: "TIFF 暂未纳入 v1 可写格式",
    });

    expect(message).toBe("不支持的格式：tiff");
    expect(message).not.toContain("暂未纳入");
  });

  it("accepts a JSON-encoded Error message from an IPC bridge", () => {
    const error = new Error(
      JSON.stringify({
        code: "thumbnailFailed",
        params: { path: "/images/source.png" },
        detail: "thumbnail decoder failed",
      }),
    );

    expect(parseCommandError(error)).toEqual({
      code: "thumbnailFailed",
      params: { path: "/images/source.png" },
      detail: "thumbnail decoder failed",
    });
  });

  it("does not expose malformed or legacy backend strings", () => {
    expect(formatCommandError("导入扫描状态锁已损坏")).toBe(
      "The requested operation could not be completed. Please try again.",
    );
    expect(formatCommandError({ code: "fileNotFound", params: null, detail: "missing" })).toBe(
      "The requested operation could not be completed. Please try again.",
    );
  });
});
