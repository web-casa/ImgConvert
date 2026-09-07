// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Production extension pages, separate document-owned queues, and no diagnostics globals. */
export async function smokeEnvironment(context, extensionOrigin, fixture, screenshotRoot) {
  await mkdir(screenshotRoot, { recursive: true });
  const full = await context.newPage();
  const side = await context.newPage();
  const pages = [full, side];
  const requests = [];
  for (const page of pages)
    page.on("request", (request) => {
      if (/^https?:/u.test(request.url())) requests.push(request.url());
    });
  const storage = (page) =>
    page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
    }));
  try {
    for (const [index, page] of pages.entries()) {
      await page.setViewportSize({ width: index ? 360 : 1280, height: 900 });
      await page.goto(`${extensionOrigin}/converter.html?surface=${index ? "side-panel" : "full"}`);
      await expect(page.locator("#workspace")).toBeVisible();
      if ((await page.locator("html").getAttribute("lang")) !== "en")
        await page.getByTestId("locale-button").click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await page.getByTestId("file-input").setInputFiles({
        name: `private-environment-${index}.bmp`,
        mimeType: "image/bmp",
        buffer: fixture,
      });
      await expect(page.getByTestId("queue-state")).toHaveAttribute("data-state", "ready");
      await page.locator('input[name="outputFormat"][value="webp"]').check();
      await page.getByTestId("convert-button").click();
      await expect(page.getByTestId("queue-state")).toHaveAttribute("data-state", "done", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("impact-measurement").first()).toContainText("Smaller by");
    }
    const fullPanel = full.getByTestId("queue-item").locator(".impact-details");
    const sidePanel = side.getByTestId("queue-item").locator(".impact-details");
    for (const page of pages) {
      const widths = await page.getByTestId("queue-item").evaluate((item) => ({
        item: item.clientWidth,
        panel: item.querySelector(".impact-details").clientWidth,
      }));
      assert.ok(
        widths.panel >= widths.item * 0.7,
        "Environmental panel must span the queue item, not the filename column",
      );
    }
    const batchPanel = full.locator(".impact-batch > .impact-details");
    await batchPanel.locator(":scope > summary").click();
    await expect(
      batchPanel.getByRole("combobox", { name: "Storage scenario", exact: true }),
    ).toHaveValue("false");
    const batchBounds = await full.locator(".queue-card").evaluate((card) => ({
      card: card.getBoundingClientRect().bottom,
      batch: card.querySelector(".impact-batch").getBoundingClientRect().bottom,
    }));
    assert.ok(
      batchBounds.batch <= batchBounds.card,
      "Batch controls must not be clipped by the queue card",
    );
    await batchPanel.locator(":scope > summary").click();
    const before = await storage(full);
    await fullPanel.locator(":scope > summary").focus();
    await full.keyboard.press("Enter");
    await expect(
      fullPanel.getByRole("combobox", { name: "Storage scenario", exact: true }),
    ).toHaveValue("false");
    await fullPanel
      .getByRole("combobox", { name: "Storage scenario", exact: true })
      .selectOption({ label: "Explore a cloud storage hypothetical" });
    await expect(fullPanel).toContainText("Cloud storage scenario estimate");
    await fullPanel
      .getByRole("combobox", { name: "Original files", exact: true })
      .selectOption("retained");
    await expect(fullPanel).toContainText("Retaining originals");
    await expect(fullPanel).not.toContainText("Cloud storage scenario estimate");
    await fullPanel
      .getByRole("combobox", { name: "Original files", exact: true })
      .selectOption("confirmed");
    await expect(fullPanel).toContainText("Self-reported replacement remains an estimate");
    await fullPanel.getByLabel("Retention days (0–3650)").fill("");
    await expect(fullPanel.getByRole("alert")).toBeVisible();
    await fullPanel.getByLabel("Retention days (0–3650)").fill("730");
    await fullPanel.getByRole("combobox", { name: "Copies", exact: true }).selectOption("3");
    await sidePanel.locator(":scope > summary").click();
    await expect(
      sidePanel.getByRole("combobox", { name: "Storage scenario", exact: true }),
    ).toHaveValue("false");
    await sidePanel
      .getByRole("combobox", { name: "Storage scenario", exact: true })
      .selectOption({ label: "Explore a cloud storage hypothetical" });
    await expect(sidePanel.getByLabel("Retention days (0–3650)")).toHaveValue("365");
    await sidePanel.locator(".impact-method > summary").click();
    await expect(sidePanel.locator(".impact-method")).toContainText("473 g CO₂/kWh");
    for (const link of await sidePanel.locator(".impact-method a").all()) {
      const url = new URL(await link.getAttribute("href"));
      assert.equal(url.search, "");
      assert.equal(url.hash, "");
      await expect(link).toHaveAttribute("rel", "noreferrer");
    }
    assert.deepEqual(
      await storage(full),
      before,
      "Environmental settings must not enter extension storage",
    );
    for (const page of pages)
      await page.evaluate(() => {
        globalThis.document.activeElement?.blur();
        globalThis.scrollTo({ top: 0, behavior: "instant" });
        globalThis.document.querySelector(".queue-list").scrollTop = 0;
      });
    await full.screenshot({ path: join(screenshotRoot, "en-full.png"), fullPage: true });
    await side.screenshot({ path: join(screenshotRoot, "en-side.png"), fullPage: true });
    await fullPanel.locator(":scope > summary").click();
    await fullPanel.locator(":scope > summary").click();
    await expect(
      fullPanel.getByRole("combobox", { name: "Storage scenario", exact: true }),
    ).toHaveValue("false");
    await side.getByTestId("locale-button").click();
    await expect(sidePanel).toContainText("云存储情景估算");
    await side.getByTestId("theme-button").click();
    await side.setViewportSize({ width: 320, height: 900 });
    assert.equal(
      await side.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
      "320 px panel must not overflow",
    );
    const accessibility = await new AxeBuilder({ page: side }).include(".impact-details").analyze();
    assert.deepEqual(accessibility.violations, [], "Environmental controls must pass axe");
    await side.evaluate(() => {
      globalThis.document.activeElement?.blur();
      globalThis.scrollTo({ top: 0, behavior: "instant" });
      globalThis.document.querySelector(".queue-list").scrollTop = 0;
    });
    await side.screenshot({ path: join(screenshotRoot, "zh-side-320.png"), fullPage: true });
    await side
      .getByTestId("queue-item")
      .getByRole("button", { name: /移除|Remove/u })
      .click();
    await expect(side.locator(".impact-details")).toHaveCount(0);
    await expect(full.getByTestId("queue-item")).toHaveCount(1);
    assert.deepEqual(requests, [], "Environmental UI must make no HTTP(S) requests");
    return {
      passed: true,
      surfaces: ["full", "side-panel-url"],
      locales: ["en", "zh"],
      minWidth: 320,
      remoteRequests: requests,
      storageUnchanged: true,
      axeRulePasses: accessibility.passes.length,
    };
  } finally {
    for (const page of pages) {
      page.on("dialog", (dialog) => dialog.accept());
      await page.close();
    }
  }
}
