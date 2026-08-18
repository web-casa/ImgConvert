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
