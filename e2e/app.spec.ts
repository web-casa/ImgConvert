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
  await expect(
    page.getByText(/网页预览不支持本机输出位置|The web preview has no local output location/),
  ).toBeVisible();
});

test("keeps the primary conversion action visible in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 540 });
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /开始转换 \/ 压缩|Start conversion \/ compression/ }),
  ).toBeVisible();
});

test("keeps the desktop queue dense and the action dock on screen", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto("/");

  const workspace = page.getByTestId("workspace-scroll");
  const actionDock = page.getByTestId("action-dock");
  const queueItems = page.getByTestId("queue-item");
  await expect(queueItems).toHaveCount(4);
  await expect(actionDock).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const workspaceBox = await workspace.boundingBox();
  expect(workspaceBox).not.toBeNull();
  const fullyVisibleRows = await queueItems.evaluateAll((items, bounds) => {
    const top = bounds?.y ?? 0;
    const bottom = top + (bounds?.height ?? 0);
    return items.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top >= top && rect.bottom <= bottom;
    }).length;
  }, workspaceBox);
  expect(fullyVisibleRows).toBeGreaterThanOrEqual(3);
});

test("opens the compact settings drawer and restores focus on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 540 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /转换设置|Conversion settings/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("dialog", { name: /转换设置|Conversion settings/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /关闭设置|Close settings/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /转换设置|Conversion settings/ })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keeps escaped focus inside the compact settings drawer", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 540 });
  await page.goto("/");

  await page.getByRole("button", { name: /转换设置|Conversion settings/ }).click();
  const dialog = page.getByRole("dialog", { name: /转换设置|Conversion settings/ });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("Tab");

  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
});

test("allows an empty output suffix draft until the field is committed", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto("/");

  await page.getByRole("button", { name: /输出行为|Output behavior/ }).click();
  const suffix = page.getByRole("textbox", { name: /文件名后缀|File-name suffix/ });
  await suffix.fill("");
  await expect(suffix).toHaveValue("");
  await expect(suffix).toHaveAttribute("aria-invalid", "true");

  await page.getByRole("slider", { name: /质量|Quality/ }).focus();
  await expect(suffix).toHaveValue("_done");
});

test("exposes names for conversion sliders and progress", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 680 });
  await page.goto("/");

  await expect(page.getByRole("slider", { name: /质量|Quality/ })).toBeVisible();
  await page.getByText(/格式参数|Format parameters/, { exact: true }).click();
  await expect(page.getByRole("slider", { name: /速度|Speed/ })).toBeVisible();
  await expect(page.getByRole("slider", { name: /最低质量|Minimum quality/ })).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /批量转换进度|Batch conversion progress/ }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /landing-hero\.png/ })).toBeVisible();
});

test.describe("locale switching", () => {
  test.use({ locale: "zh-CN" });

  test("updates visible UI when switching between Chinese and English", async ({ page }) => {
    await page.goto("/");

    const chineseLanguageButton = page.getByTitle("语言");
    await expect(chineseLanguageButton).toBeVisible();
    await expect(page).toHaveTitle("ImgConvert · 图片与 PDF 批量转换");
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
    await expect(page).toHaveTitle("ImgConvert · Batch Image and PDF Converter");
    await expect(englishLanguageButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Start conversion / compression" }),
    ).toBeVisible();
    await expect(page.getByText("Speed 8", { exact: true })).toBeVisible();
    await expect(page.getByText("Web preview sample", { exact: true }).first()).toBeVisible();

    await englishLanguageButton.click();

    await expect(page.getByTitle("语言")).toBeVisible();
    await expect(page).toHaveTitle("ImgConvert · 图片与 PDF 批量转换");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("button", { name: "开始转换 / 压缩" })).toBeVisible();
    await expect(page.getByText("速度 8", { exact: true })).toBeVisible();
    await expect(page.getByText("网页预览示例", { exact: true }).first()).toBeVisible();
  });
});
