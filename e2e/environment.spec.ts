// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "@playwright/test";

// Exercise the desktop Svelte view with explicit result fixtures.
// This is browser-preview coverage, not native installer or IPC smoke.
for (const locale of ["en-US", "zh-CN"]) {
  test(`desktop environmental assumptions and lifecycle (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: locale === "en-US" ? 1000 : 375, height: 800 });
    await page.goto("/");
    await expect(page.getByTestId("queue-item")).toHaveCount(4);
    await page.evaluate(async (language) => {
      const statePath = "/src/lib/state.svelte.ts";
      const localePath = "/src/lib/i18n/index.ts";
      const impactPath = "/src/lib/desktop-impact.ts";
      const { queue } = await import(/* @vite-ignore */ statePath);
      const { setAppLocale } = await import(/* @vite-ignore */ localePath);
      const { captureDesktopImpact } = await import(/* @vite-ignore */ impactPath);
      await setAppLocale(language);
      queue.splice(2);
      for (const [index, item] of queue.entries()) {
        item.status = "done";
        item.impact = captureDesktopImpact(
          {
            input: item.path,
            inSize: 1000000,
            outSize: index ? 2000000 : 400000,
            environmentComparable: true,
            outputCount: 1,
          },
          item.path,
        );
      }
      if (language === "zh-CN") document.documentElement.classList.add("dark");
    }, locale);
    const panels = page.getByTestId("environment-panel");
    await expect(panels).toHaveCount(3);
    const single = panels.first();
    await expect(single.getByTestId("environment-measurement")).toContainText("586");
    await expect(panels.last().getByTestId("environment-measurement")).toContainText("391");
    const summary = single.locator(":scope > details > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    const storage = single.getByRole("combobox").first();
    await expect(storage).toHaveValue("false");
    await expect(single.getByRole("spinbutton")).toHaveCount(0);
    await storage.selectOption({ index: 1 });
    await expect(
      single.getByText(/Cloud storage scenario estimate|云存储情景估算/, { exact: true }),
    ).toBeVisible();
    const originals = single.getByRole("combobox").nth(1);
    await originals.selectOption("retained");
    await expect(
      single.getByText(/Cloud storage scenario estimate|云存储情景估算/, { exact: true }),
    ).toHaveCount(0);
    await originals.selectOption("confirmed");
    await single.getByRole("spinbutton").fill("-1");
    await expect(single.getByRole("alert")).toBeVisible();
    await single.getByRole("spinbutton").fill("365");
    await expect(single.getByRole("alert")).toHaveCount(0);
    await single.screenshot({ path: `/tmp/imgconvert-desktop-environment-${locale}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await summary.click();
    await summary.click();
    await expect(storage).toHaveValue("false");
    await storage.selectOption({ index: 1 });
    await expect(originals).toHaveValue("hypothetical");
    const batch = panels.last();
    await batch.locator(":scope > details > summary").click();
    await batch.getByRole("combobox").first().selectOption({ index: 1 });
    await expect(batch.getByText(/No net output reduction|输出没有净减少/)).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/lib/state.svelte.ts";
      const { queue } = await import(/* @vite-ignore */ path);
      queue.splice(0);
    });
    await expect(panels).toHaveCount(0);
  });
}
