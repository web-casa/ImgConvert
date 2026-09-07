// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

describe("desktop conversion", () => {
  it("previews and converts seeded PNG and PDF inputs through the workflow backend", async () => {
    await browser.waitUntil(async () => (await $$('[data-testid="queue-item"]')).length === 2, {
      timeout: 20_000,
      timeoutMsg: "desktop E2E fixtures were not both queued",
    });
    const queueItem = await firstQueueItem();
    await queueItem.waitForExist({ timeout: 20_000 });
    expect((await queueStatuses())[0]).toBe("pending");

    const compare = await $('[data-testid="comparison-preview-open"]');
    await compare.waitForClickable({ timeout: 20_000 });
    await compare.click();
    const preview = await $('[data-testid="comparison-preview"]');
    await preview.waitForDisplayed({ timeout: 20_000 });
    await browser.waitUntil(
      async () => {
        const status = await preview.getAttribute("data-status");
        if (status === "error") {
          throw new Error(`desktop preview failed: ${await preview.getText()}`);
        }
        const text = await preview.getText();
        return text.includes("32 × 32") && text.includes("16 × 16");
      },
      { timeout: 60_000, timeoutMsg: "workflow preview did not report resized dimensions" },
    );
    await $('[data-testid="comparison-preview-close"]').click();
    await preview.waitForDisplayed({ reverse: true, timeout: 10_000 });

    const start = await $('[data-testid="start-conversion"]');
    await start.waitForEnabled({ timeout: 20_000 });
    await start.click();
    const deadline = Date.now() + 60_000;
    let status = (await queueStatuses())[0];
    while (
      status !== "done" &&
      status !== "error" &&
      status !== "skipped" &&
      Date.now() < deadline
    ) {
      await browser.pause(100);
      status = (await queueStatuses())[0];
    }
    if (status !== "done") {
      throw new Error(`desktop conversion ended as ${status}: ${await queueText(0)}`);
    }
    await browser.waitUntil(
      async () => {
        const statuses = await queueStatuses();
        if (statuses.includes("error") || statuses.includes("skipped")) {
          throw new Error(`desktop batch ended with statuses: ${statuses.join(", ")}`);
        }
        return statuses.every((itemStatus) => itemStatus === "done");
      },
      { timeout: 60_000, timeoutMsg: "desktop PNG/PDF batch did not finish" },
    );

    const output = path.join(
      process.env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT,
      "output",
      "fixture_done.jpg",
    );
    expect(existsSync(output)).toBe(true);
    const bytes = readFileSync(output);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(readJpegDimensions(bytes)).toEqual([16, 16]);
    expect(bytes.length).toBeLessThanOrEqual(16 * 1024);

    for (const page of ["001", "002"]) {
      const pageOutput = path.join(
        process.env.IMGCONVERT_DESKTOP_E2E_SESSION_ROOT,
        "output",
        `document_done-page-${page}.jpg`,
      );
      expect(existsSync(pageOutput)).toBe(true);
      const pageBytes = readFileSync(pageOutput);
      expect([...pageBytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      expect(readJpegDimensions(pageBytes)).toEqual([36, 36]);
      expect(pageBytes.length).toBeLessThanOrEqual(16 * 1024);
    }
  });

  it("uses native byte evidence and excludes PDF from environmental scenarios", async () => {
    const panels = await $$('[data-testid="environment-panel"]');
    expect(panels.length).toBe(3);
    const single = panels[0];
    const pdf = panels[1];
    const batch = panels[2];
    const original = readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_INPUT);
    const originalPdf = readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_PDF_INPUT);
    const inputBytes = original.length;
    const outputBytes = readFileSync(
      path.join(process.env.IMGCONVERT_DESKTOP_E2E_OUT_DIR, "fixture_done.jpg"),
    ).length;
    expect(inputBytes).toBeGreaterThan(outputBytes);
    const saved = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 }).format(
      (inputBytes - outputBytes) / 1024,
    );
    // Compare visible facts to disk bytes, independently of the IPC result.
    expect(inputBytes - outputBytes).toBeGreaterThanOrEqual(1024);
    expect(inputBytes - outputBytes).toBeLessThan(1024 * 1024);
    expect(await single.$('[data-testid="environment-measurement"]').getText()).toBe(
      `Output smaller by ${saved} KiB`,
    );
    const summary = await single.$("details > summary");
    await summary.click();
    const storage = await single.$("select");
    expect(await storage.getValue()).toBe("false");
    await storage.selectByIndex(1);
    await browser.waitUntil(async () =>
      (await single.getText()).includes("Cloud storage scenario estimate"),
    );
    mkdirSync(path.resolve("artifacts/desktop-e2e"), { recursive: true });
    await browser.saveScreenshot(path.resolve("artifacts/desktop-e2e/environment-en.png"));
    await $('button[title="Language"]').click();
    await browser.waitUntil(async () => (await single.getText()).includes("云存储情景估算"));
    await browser.saveScreenshot(path.resolve("artifacts/desktop-e2e/environment-zh.png"));
    await $('button[title="语言"]').click();
    await browser.waitUntil(async () =>
      (await single.getText()).includes("Cloud storage scenario estimate"),
    );
    const selects = await single.$$("select");
    await selects[1].selectByAttribute("value", "retained");
    await browser.waitUntil(async () => (await single.getText()).includes("Retaining originals"));
    expect(await single.getText()).not.toContain("Cloud storage scenario estimate");
    await summary.click();
    await summary.click();
    expect(await storage.getValue()).toBe("false");
    await pdf.$("details > summary").click();
    expect(await pdf.getText()).toContain(
      "A comparable single static raster result has not been confirmed",
    );
    expect((await pdf.$$("select")).length).toBe(0);
    expect(await batch.getText()).toContain(
      "Batch: 1 eligible results; 1 other completed results excluded",
    );
    expect(await batch.$('[data-testid="environment-measurement"]').getText()).toBe(
      await single.$('[data-testid="environment-measurement"]').getText(),
    );
    // Existing inputs are still present and unchanged by scenario interactions.
    expect(readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_INPUT)).toEqual(original);
    expect(readFileSync(process.env.IMGCONVERT_DESKTOP_E2E_PDF_INPUT)).toEqual(originalPdf);
    expect(existsSync(process.env.IMGCONVERT_DESKTOP_E2E_PDF_INPUT)).toBe(true);
  });

  it("clears prior impact when a native retry is skipped", async () => {
    await $('[data-slot="select-trigger"][aria-label="Target format for fixture.png"]').click();
    const search = await $('input[placeholder="Search formats"]');
    await search.setValue("jpeg");
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await queueStatuses())[0] === "pending");
    expect((await $$('[data-testid="environment-panel"]')).length).toBe(1);
    await $('[data-testid="start-conversion"]').click();
    await browser.waitUntil(async () => (await queueStatuses())[0] === "skipped", {
      timeout: 20000,
    });
    // Only the excluded PDF result remains; neither the PNG nor batch keeps old evidence.
    expect((await $$('[data-testid="environment-panel"]')).length).toBe(1);
  });
});

async function firstQueueItem() {
  const item = (await $$('[data-testid="queue-item"]'))[0];
  if (!item) throw new Error("desktop E2E queue is empty");
  return item;
}

async function queueStatuses() {
  return browser.execute(() =>
    [...globalThis.document.querySelectorAll('[data-testid="queue-item"]')].map((item) =>
      item.getAttribute("data-status"),
    ),
  );
}

async function queueText(index) {
  return browser.execute(
    (itemIndex) =>
      globalThis.document.querySelectorAll('[data-testid="queue-item"]')[itemIndex]?.textContent ??
      "",
    index,
  );
}

function readJpegDimensions(bytes) {
  let offset = 2;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 8 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += segmentLength;
  }
  throw new Error("converted JPEG has no supported SOF dimensions");
}
