import { expect, test } from "@playwright/test";

import { testPng } from "./fixtures/png";

test("uploads, exposes the queue, and converts without leaving the device", async ({
  baseURL,
  page,
}) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Convert images");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "mobile-preview.png",
  });

  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await expect(queueItem).toContainText("8 × 6");
  await expect(queueItem).toBeInViewport();

  const layout = await page.evaluate(() => {
    const importSection = document.querySelector("#sl-import")?.getBoundingClientRect();
    const queueRail = document.querySelector(".v-softlab-queue-rail")?.getBoundingClientRect();
    const settingsSection = document.querySelector("#sl-settings")?.getBoundingClientRect();
    return {
      importBottom: importSection?.bottom ?? -1,
      overflow: document.documentElement.scrollWidth - innerWidth,
      queueBottom: queueRail?.bottom ?? -1,
      queueTop: queueRail?.top ?? -1,
      settingsTop: settingsSection?.top ?? -1,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.queueTop).toBeGreaterThan(layout.importBottom);
  expect(layout.settingsTop).toBeGreaterThan(layout.queueBottom);

  await page.getByRole("button", { name: "Start Conversion" }).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  const downloadPromise = page.waitForEvent("download");
  await queueItem.getByRole("button", { name: /Download Result/u }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.webp$/u);

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
