// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";

test("loads the web preview shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ImgConvert" })).toBeVisible();
  await expect(
    page.locator(
      "header span[title*='网页预览'], header span[title*='Core 就绪'], header span[title*='Web preview'], header span[title*='Core ready']",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始转换 \/ 压缩|Start conversion \/ compression/ }),
  ).toBeVisible();
});

test("keeps the primary conversion action visible in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 540 });
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /开始转换 \/ 压缩|Start conversion \/ compression/ }),
  ).toBeVisible();
});

test.describe("locale switching", () => {
  test.use({ locale: "zh-CN" });

  test("updates visible UI when switching between Chinese and English", async ({ page }) => {
    await page.goto("/");

    const chineseLanguageButton = page.getByTitle("语言");
    await expect(chineseLanguageButton).toBeVisible();
    await expect(page).toHaveTitle("ImgConvert · 图片批量转换");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(chineseLanguageButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "开始转换 / 压缩" })).toBeVisible();
    await expect(page.getByText("速度 8", { exact: true })).toBeVisible();
    await expect(page.getByText("网页预览示例", { exact: true }).first()).toBeVisible();

    await page.getByTitle("插件诊断").click();
    await expect(page.getByText("此操作需要在 Tauri 桌面端完成。")).toBeVisible();
    await chineseLanguageButton.evaluate((button) => (button as HTMLElement).click());
    await expect(page.getByText("This action requires the Tauri desktop app.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await page.getByTitle("Close").click();

    const englishLanguageButton = page.getByTitle("Language");
    await expect(englishLanguageButton).toBeVisible();
    await expect(page).toHaveTitle("ImgConvert · Batch Image Converter");
    await expect(englishLanguageButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Start conversion / compression" }),
    ).toBeVisible();
    await expect(page.getByText("Speed 8", { exact: true })).toBeVisible();
    await expect(page.getByText("Web preview sample", { exact: true }).first()).toBeVisible();

    await englishLanguageButton.click();

    await expect(page.getByTitle("语言")).toBeVisible();
    await expect(page).toHaveTitle("ImgConvert · 图片批量转换");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("button", { name: "开始转换 / 压缩" })).toBeVisible();
    await expect(page.getByText("速度 8", { exact: true })).toBeVisible();
    await expect(page.getByText("网页预览示例", { exact: true }).first()).toBeVisible();
  });
});
