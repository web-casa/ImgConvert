// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";
import { testPng } from "./fixtures/png";

test("bilingual calculators preserve assumptions, units and offline operation", async ({
  page,
  context,
}, testInfo) => {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      unexpected.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/en/environment/");
  const individual = page.getByRole("region", { name: "One smaller file" });
  const global = page.getByRole("region", { name: "What if everyone stored 1 MB less each day?" });
  await expect(individual).toContainText("2.96–17.7 mg CO₂");
  await expect(global).toContainText("2.19 EB");
  await expect(global).toContainText("6.88–13.7 GWh");
  await page.screenshot({
    path: testInfo.outputPath("environment-en-desktop.png"),
    fullPage: true,
  });
  await context.setOffline(true);
  await individual.getByLabel("I still retain the original").check();
  await expect(individual).not.toContainText("mg CO₂");
  await individual.getByLabel("I still retain the original").uncheck();
  await individual.getByLabel("Days (whole number)").fill("");
  await expect(individual.getByRole("alert")).toBeVisible();
  await individual.getByLabel("Days (whole number)").fill("365");
  await individual.getByRole("combobox", { name: "Copies", exact: true }).selectOption("1");
  await expect(individual).toContainText("2.96–5.89 mg CO₂");
  await individual.getByLabel(/Explore a cloud storage/).uncheck();
  await expect(individual).not.toContainText("mg CO₂");
  await global.getByLabel("Participation (0–100%)").fill("0");
  await expect(global).toContainText("0 EB");
  await global.getByLabel("Days (whole number)").fill("0");
  await expect(global.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Reset parameters" }).click();
  await expect(global).toContainText("6.88–13.7 GWh");
  await context.setOffline(false);
  await page.getByRole("link", { name: "中文", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("让图片更轻");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator("#calculators")).toContainText("2.96–17.7 mg CO₂");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("environment-zh-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("science and limitations remain available without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const locale of ["", "en/"]) {
      await page.goto(`http://127.0.0.1:4176/${locale}environment/`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main")).toContainText("473 g CO₂/kWh");
      await expect(page.getByRole("link", { name: /Cloud Carbon Footprint/ })).toBeVisible();
      await expect(page.locator('a[href="/convert/"]')).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test("conversion panels are private, opt-in, independent and reset on close", async ({
  page,
  context,
}, testInfo) => {
  const unexpected: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") {
      unexpected.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("http://127.0.0.1:4175/convert/?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(256, 256),
    name: "private-source.png",
    mimeType: "image/png",
  });
  const item = page.locator(".queue-item");
  await expect(item).toContainText("Ready to configure");
  await page.getByRole("button", { name: "Start Conversion", exact: true }).click();
  await expect(item).toContainText("Ready to download");
  const panel = item.locator(".impact-details");
  await panel.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByLabel("Storage scenario")).toHaveValue("false");
  await context.setOffline(true);
  await panel
    .getByLabel("Storage scenario")
    .selectOption({ label: "Explore a cloud storage hypothetical" });
  await expect(panel).toContainText("Cloud storage scenario estimate");
  await panel.getByLabel("Original files").selectOption("retained");
  await expect(panel).toContainText("Retaining originals");
  await expect(panel).not.toContainText("mg CO₂");
  await panel.getByLabel("Original files").selectOption("hypothetical");
  await panel.getByLabel("Retention days (0–3650)").fill("-1");
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.locator("summary").click();
  await panel.locator("summary").click();
  await expect(panel.getByLabel("Storage scenario")).toHaveValue("false");
  const batch = page.locator(".local-ledger .impact-details");
  await batch.locator("summary").click();
  await expect(batch.getByLabel("Storage scenario")).toHaveValue("false");
  await expect(panel.getByRole("link", { name: /Method, factors/ })).toHaveAttribute(
    "href",
    "/en/environment/",
  );
  await expect(panel.getByRole("link", { name: /Method, factors/ })).toHaveAttribute(
    "rel",
    "noreferrer",
  );
  await page.screenshot({ path: testInfo.outputPath("converter-en-panels.png"), fullPage: true });
  await panel
    .getByLabel("Storage scenario")
    .selectOption({ label: "Explore a cloud storage hypothetical" });
  await page.getByRole("button", { name: "Use Dark Theme", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("converter-dark-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear Queue", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear Files", exact: true }).click();
  await expect(page.locator(".impact-details")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});
