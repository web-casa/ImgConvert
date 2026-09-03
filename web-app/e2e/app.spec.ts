import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { testPng } from "./fixtures/png";

const FORMATS = ["jpeg", "png", "webp", "avif"] as const;
type Format = (typeof FORMATS)[number];

const EXTENSIONS: Record<Format, string> = {
  avif: "avif",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

function testBmp(width = 8, height = 6, bitsPerPixel: 24 | 32 = 24): Buffer {
  const stride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const pixelBytes = stride * height;
  const output = Buffer.alloc(54 + pixelBytes);
  output.write("BM", 0, "ascii");
  output.writeUInt32LE(output.byteLength, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(bitsPerPixel, 28);
  output.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bytesPerPixel = bitsPerPixel / 8;
      const offset = 54 + y * stride + x * bytesPerPixel;
      output[offset] = 170;
      output[offset + 1] = 90 + y * 14;
      output[offset + 2] = 40 + x * 12;
      if (bitsPerPixel === 32) output[offset + 3] = 255;
    }
  }
  return output;
}

function testGif(animated = false): Buffer {
  const base = Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255]);
  const image = Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x4c, 0]);
  return Buffer.concat([base, image, ...(animated ? [image] : []), Buffer.from([0x3b])]);
}

function safeSvg(width = 8, height = 6): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#326a39"/><stop offset="1" stop-color="#e5f0e0"/></linearGradient></defs><rect width="${width}" height="${height}" rx="1" fill="url(#brand)"/><circle cx="${width / 2}" cy="${height / 2}" r="2" fill="#f8f5ed"/></svg>`,
    "utf8",
  );
}

function testPdf(
  pages: ReadonlyArray<Readonly<{ height: number; width: number }>> = [
    { height: 54, width: 72 },
    { height: 72, width: 54 },
  ],
  options: Readonly<{ externalLink?: boolean; javaScript?: boolean }> = {},
): Buffer {
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  let nextObjectNumber = 3 + pages.length * 2;
  const actionObjectNumber = options.javaScript ? nextObjectNumber++ : undefined;
  const linkObjectNumber = options.externalLink ? nextObjectNumber++ : undefined;
  const catalog = options.javaScript
    ? `<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript << /Names [(open) ${actionObjectNumber} 0 R] >> >> >>`
    : "<< /Type /Catalog /Pages 2 0 R >>";
  const objects = new Map<number, string>([
    [1, catalog],
    [
      2,
      `<< /Type /Pages /Kids [${pageObjectNumbers.map((object) => `${object} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ],
  ]);
  pages.forEach(({ height, width }, index) => {
    const pageObjectNumber = pageObjectNumbers[index]!;
    const contentObjectNumber = pageObjectNumber + 1;
    const color = index % 2 === 0 ? "0.20 0.42 0.23" : "0.94 0.72 0.17";
    const content = `q ${color} rg 0 0 ${width} ${height} re f Q`;
    objects.set(
      pageObjectNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${contentObjectNumber} 0 R${index === 0 && linkObjectNumber ? ` /Annots [${linkObjectNumber} 0 R]` : ""} >>`,
    );
    objects.set(
      contentObjectNumber,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  });
  if (options.javaScript) {
    objects.set(actionObjectNumber!, "<< /S /JavaScript /JS (app.alert\\(1\\)) >>");
  }
  if (linkObjectNumber) {
    objects.set(
      linkObjectNumber,
      "<< /Type /Annot /Subtype /Link /Rect [0 0 36 18] /A << /S /URI /URI (https://example.com/pdf-link) >> >>",
    );
  }

  const objectCount = Math.max(...objects.keys());
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "binary")];
  const offsets = [0];
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    const body = objects.get(objectNumber);
    if (!body) throw new Error(`Missing PDF object ${objectNumber}.`);
    offsets[objectNumber] = Buffer.concat(parts).byteLength;
    parts.push(Buffer.from(`${objectNumber} 0 obj\n${body}\nendobj\n`, "binary"));
  }
  const xrefOffset = Buffer.concat(parts).byteLength;
  parts.push(Buffer.from(`xref\n0 ${objectCount + 1}\n`, "ascii"));
  parts.push(Buffer.from("0000000000 65535 f \n", "ascii"));
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    parts.push(
      Buffer.from(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`, "ascii"),
    );
  }
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "ascii",
    ),
  );
  return Buffer.concat(parts);
}

async function encryptedPdf(): Promise<Buffer> {
  const source = await readFile(new URL("./fixtures/encrypted-pdf.b64", import.meta.url), "utf8");
  return Buffer.from(source.replaceAll(/\s/gu, ""), "base64");
}

function jpegApp1(payload: Buffer): Buffer {
  const length = payload.byteLength + 2;
  if (length > 65_535) throw new Error("JPEG APP1 fixture is too large.");
  return Buffer.concat([Buffer.from([0xff, 0xe1, length >>> 8, length & 0xff]), payload]);
}

function jpegWithOrientationAndXmp(jpeg: Buffer): Buffer {
  const exif = Buffer.alloc(32);
  exif.write("Exif\0\0", 0, "binary");
  exif.write("II", 6, "ascii");
  exif.writeUInt16LE(42, 8);
  exif.writeUInt32LE(8, 10);
  exif.writeUInt16LE(1, 14);
  exif.writeUInt16LE(0x0112, 16);
  exif.writeUInt16LE(3, 18);
  exif.writeUInt32LE(1, 20);
  exif.writeUInt16LE(6, 24);
  exif.writeUInt32LE(0, 28);
  const xmp = Buffer.from("http://ns.adobe.com/xap/1.0/\0IMGCONVERT_METADATA_WEB_005", "utf8");
  return Buffer.concat([jpeg.subarray(0, 2), jpegApp1(exif), jpegApp1(xmp), jpeg.subarray(2)]);
}

function expectMagic(bytes: Buffer, format: Format): void {
  if (format === "jpeg") {
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  } else if (format === "png") {
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  } else if (format === "webp") {
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  } else {
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
  }
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Playwright did not expose the downloaded file path.");
  return readFile(path);
}

function storedZipEntries(archive: Buffer): ReadonlyMap<string, Buffer> {
  const endMinimum = 22;
  let endOffset = -1;
  for (
    let offset = archive.byteLength - endMinimum;
    offset >= Math.max(0, archive.byteLength - 65_557);
    offset -= 1
  ) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP end record is missing.");
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is invalid.");
    }
    const flags = archive.readUInt16LE(centralOffset + 8);
    const method = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const size = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    if ((flags & 1) !== 0 || method !== 0 || compressedSize !== size) {
      throw new Error("WEB-008 ZIP must contain unencrypted stored entries.");
    }
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString();
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP local entry is invalid.");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, archive.subarray(dataOffset, dataOffset + size));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const FORMAT_LABELS: Record<Format, string> = {
  avif: "AVIF",
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
};

async function selectOutputFormat(page: Page, output: Format): Promise<void> {
  const radio = page.getByRole("radio", { exact: true, name: FORMAT_LABELS[output] });
  await radio.focus();
  await radio.press("Space");
  await expect(radio).toBeChecked();
}

function convertButton(page: Page) {
  return page.getByRole("button", { name: /^(?:Start Conversion|Convert Again)$/u });
}

async function clearQueue(page: Page): Promise<void> {
  const clear = page.getByRole("button", { name: "Clear Queue" });
  if (await clear.isEnabled()) {
    await clear.click();
    const dialog = page.getByRole("dialog", { name: "Clear the Import Queue?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Clear Files" }).click();
    await expect(page.locator(".queue-item")).toHaveCount(0);
  }
}

async function waitForOfflineTools(page: Page): Promise<void> {
  await expect(page.getByText("Offline tools are ready")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function disablePwaForRequestInterception(page: Page): Promise<void> {
  // Playwright page routes cannot intercept a request once a Service Worker handles it. These
  // tests deliberately stall engine startup, so keep their page outside the separate PWA suite.
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
  });
}

async function pwaCacheRequests(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("imgconvert-web:"));
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map(({ url }) => url));
    }
    return urls.sort();
  });
}

async function convertOne(
  page: Page,
  input: Buffer,
  inputName: string,
  output: Format,
): Promise<Buffer> {
  await page.locator('input[type="file"]').setInputFiles({
    buffer: input,
    mimeType: "application/octet-stream",
    name: inputName,
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, output);
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });

  const downloadPromise = page.waitForEvent("download");
  await queueItem.getByRole("button", { name: /Download Result/u }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${EXTENSIONS[output]}$`, "u"));
  const bytes = await downloadBytes(download);
  expectMagic(bytes, output);
  await clearQueue(page);
  return bytes;
}

test("converts locally, compares the result, downloads it, and clears memory", async ({
  baseURL,
  page,
}) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  const wasmRequests: string[] = [];
  const requestPayloads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".wasm")) wasmRequests.push(url.pathname);
    requestPayloads.push(
      `${request.url()} ${request.postData() ?? ""} ${JSON.stringify(request.headers())}`,
    );
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Convert images");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "pixel.png",
  });

  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await expect(queueItem).toContainText("8 × 6");
  expect(wasmRequests).toEqual([]);
  await page.getByRole("checkbox", { name: /Lossless output/u }).check();
  await page.getByLabel("Image size").selectOption("custom");
  await page.getByRole("spinbutton", { name: "Width" }).fill("4");
  await page.getByRole("spinbutton", { name: "Height" }).fill("3");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await expect(queueItem).toContainText("4 × 3");
  expect(wasmRequests.length).toBeGreaterThan(0);
  expect(wasmRequests.some((url) => url.includes("avif"))).toBe(false);
  await queueItem.getByRole("button", { name: /Compare Images/u }).click();

  const dialog = page.getByRole("dialog", { name: "Before & After" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("figure img")).toHaveCount(2);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download Result" }).click();
  const output = await downloadBytes(await downloadPromise);
  expectMagic(output, "webp");
  await dialog.getByRole("button", { name: "Close Preview" }).click();

  expect(externalRequests).toEqual([]);
  expect(requestPayloads.join("\n")).not.toContain("pixel.png");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await expect(queueItem).toContainText("PNG");
  await page.getByRole("button", { name: "切换为中文" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("图片留在原地");
  await page.getByRole("button", { name: "清空队列" }).click();
  await page.getByRole("button", { name: "清空文件" }).click();
  await expect(queueItem).toHaveCount(0);
});

test("passes the JPEG, PNG, WebP, and AVIF 4 × 4 round-trip matrix", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("?lang=en");
  const seed = testPng();
  const sources = new Map<Format, Buffer>();
  for (const inputFormat of FORMATS) {
    sources.set(inputFormat, await convertOne(page, seed, "matrix-seed.png", inputFormat));
  }
  for (const inputFormat of FORMATS) {
    const source = sources.get(inputFormat);
    if (!source) throw new Error(`Missing generated ${inputFormat} source.`);
    for (const outputFormat of FORMATS) {
      await convertOne(page, source, `matrix-input.${EXTENSIONS[inputFormat]}`, outputFormat);
    }
  }
});

test("converts BMP and static GIF to every raster output and rejects animated GIF", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("?lang=en");
  for (const output of FORMATS) {
    await test.step(`BMP to ${output}`, async () => {
      await convertOne(page, testBmp(), "source.bmp", output);
    });
  }
  await test.step("32-bit BMP to png", async () => {
    await convertOne(page, testBmp(8, 6, 32), "source-32.bmp", "png");
  });
  for (const output of FORMATS) {
    await test.step(`GIF to ${output}`, async () => {
      await page.locator('input[type="file"]').setInputFiles({
        buffer: testGif(),
        mimeType: "image/gif",
        name: "source.gif",
      });
      const queueItem = page.locator(".queue-item");
      await expect(queueItem).toContainText("GIF input is decoded as one still frame");
      await selectOutputFormat(page, output);
      await convertButton(page).click();
      await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
      const downloadPromise = page.waitForEvent("download");
      await queueItem.getByRole("button", { name: /Download Result/u }).click();
      expectMagic(await downloadBytes(await downloadPromise), output);
      await clearQueue(page);
    });
  }

  await page.locator('input[type="file"]').setInputFiles({
    buffer: testGif(true),
    mimeType: "image/gif",
    name: "animated.gif",
  });
  await expect(page.locator(".queue-item")).toContainText("Animated images are not supported yet");
});

test("renders safe SVG to every raster output without loading resvg early", async ({
  baseURL,
  page,
}) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  const wasmRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".wasm")) wasmRequests.push(url.pathname);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  expect(wasmRequests.some((path) => path.includes("index_bg-"))).toBe(false);
  for (const output of FORMATS) {
    await convertOne(page, safeSvg(), "safe-vector.svg", output);
  }

  expect(wasmRequests.some((path) => path.includes("index_bg-"))).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("renders PDF input to every raster output", async ({ baseURL, page }) => {
  test.setTimeout(180_000);
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  for (const output of FORMATS) {
    await test.step(`PDF to ${output}`, async () => {
      await convertOne(page, testPdf([{ height: 24, width: 32 }]), "source.pdf", output);
    });
  }
  expect(externalRequests).toEqual([]);
});

test("renders selected PDF pages locally with bounded DPI and verified downloads", async ({
  baseURL,
  browserName,
  page,
}) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  const pdfWorkerRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/pdf(?:-codec)?\.worker-/u.test(url.pathname)) pdfWorkerRequests.push(url.pathname);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("?lang=en");
  expect(pdfWorkerRequests).toEqual([]);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPdf(undefined, { externalLink: true }),
    mimeType: "application/pdf",
    name: "local-pages.pdf",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await expect(page.getByRole("textbox", { name: "Pages" })).toHaveValue("1");
  await page.getByRole("textbox", { name: "Pages" }).fill("1-2");
  await page.getByRole("spinbutton", { name: "Render DPI" }).fill("72");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await expect(queueItem).toContainText("2 pages ready");
  await expect(queueItem.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(queueItem.getByText("Page 2", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  expect(pdfWorkerRequests.some((path) => path.includes("pdf-codec.worker-"))).toBe(true);
  if (browserName !== "firefox") {
    // Firefox does not surface nested Worker requests through Page request events.
    expect(pdfWorkerRequests.some((path) => path.includes("pdf.worker-"))).toBe(true);
  }

  const firstDownloadPromise = page.waitForEvent("download");
  await queueItem
    .getByRole("button", { name: /Download Result: local-pages-page-001\.png/u })
    .click();
  const firstDownload = await firstDownloadPromise;
  expect(firstDownload.suggestedFilename()).toBe("local-pages-page-001.png");
  expectMagic(await downloadBytes(firstDownload), "png");

  await queueItem
    .getByRole("button", { name: /Compare Images: local-pages-page-002\.png/u })
    .click();
  const dialog = page.getByRole("dialog", { name: "Before & After" });
  await expect(dialog.locator("figure img")).toHaveCount(1);
  await expect(dialog).toContainText("Page 2");
  await dialog.getByRole("button", { name: "Close Preview" }).click();
  expect(externalRequests).toEqual([]);
  await clearQueue(page);
});

test("downloads a bounded local ZIP with collision-safe batch filenames", async ({
  baseURL,
  page,
}) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const archiveWorkerRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("archive.worker-")) archiveWorkerRequests.push(url.pathname);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles([
    { buffer: testPng(), mimeType: "image/png", name: "same.png" },
    { buffer: testPng(7, 5), mimeType: "image/png", name: "same.png" },
  ]);
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to configure" })).toHaveCount(
    2,
  );
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to download" })).toHaveCount(
    2,
    { timeout: 90_000 },
  );
  const batch = page.getByRole("region", { name: "Export the Batch" });
  await expect(batch).toContainText("Results · 2");
  await expect(batch).toContainText("PNG");
  expect(archiveWorkerRequests).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);

  const downloadPromise = page.waitForEvent("download");
  await batch.getByRole("button", { name: "Download ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("imgconvert-results.zip");
  const zipEntries = storedZipEntries(await downloadBytes(download));
  expect([...zipEntries.keys()]).toEqual(["same.png", "same (2).png"]);
  expectMagic(zipEntries.get("same.png") ?? Buffer.alloc(0), "png");
  expectMagic(zipEntries.get("same (2).png") ?? Buffer.alloc(0), "png");
  expect(archiveWorkerRequests).toHaveLength(1);
  expect(externalRequests).toEqual([]);
  await expect(batch).toContainText("ZIP download started");
});

test("includes a structured failure report when a batch only partly succeeds", async ({ page }) => {
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles([
    { buffer: testPng(), mimeType: "image/png", name: "good.png" },
    { buffer: Buffer.from("not an image"), mimeType: "text/plain", name: "bad.txt" },
  ]);
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to configure" })).toHaveCount(
    1,
  );
  await expect(page.locator(".queue-item").filter({ hasText: "Needs attention" })).toHaveCount(1);
  await selectOutputFormat(page, "webp");
  await convertButton(page).click();
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to download" })).toHaveCount(
    1,
    { timeout: 90_000 },
  );

  const batch = page.getByRole("region", { name: "Export the Batch" });
  await expect(batch).toContainText("Failed · 1");
  await expect(batch).toContainText("JSON report included");
  const downloadPromise = page.waitForEvent("download");
  await batch.getByRole("button", { name: "Download ZIP" }).click();
  const entries = storedZipEntries(await downloadBytes(await downloadPromise));
  expect([...entries.keys()]).toEqual(["good.webp", "imgconvert-failures.json"]);
  const manifest = JSON.parse(entries.get("imgconvert-failures.json")?.toString() ?? "{}");
  expect(manifest).toMatchObject({
    failedCount: 1,
    failures: [{ code: "unsupported-input", sourceName: "bad.txt" }],
    schemaVersion: 1,
    status: "partial",
  });
});

test("writes batch results serially to a selected folder without overwriting", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "The directory picker path is exercised in Chromium.");
  await page.addInitScript(() => {
    const files = new Map<string, number[]>([["photo.webp", [7]]]);
    Object.assign(globalThis, {
      __imgconvertDirectoryFiles: files,
      showDirectoryPicker: async () => ({
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
          if (!files.has(name) && !options?.create) {
            throw new DOMException("missing", "NotFoundError");
          }
          return {
            createWritable: async () => ({
              abort: async () => undefined,
              close: async () => undefined,
              write: async (blob: Blob) => {
                files.set(name, [...new Uint8Array(await blob.arrayBuffer())]);
              },
            }),
          };
        },
      }),
    });
  });
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles([
    { buffer: testPng(), mimeType: "image/png", name: "photo.png" },
    { buffer: testPng(7, 5), mimeType: "image/png", name: "other.png" },
  ]);
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to configure" })).toHaveCount(
    2,
  );
  await convertButton(page).click();
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to download" })).toHaveCount(
    2,
    { timeout: 90_000 },
  );
  const batch = page.getByRole("region", { name: "Export the Batch" });
  await batch.getByRole("button", { name: /Save to Folder/u }).click();
  await expect(batch).toContainText("Saved 2 result files");
  const saved = await page.evaluate(() => {
    const files = (
      globalThis as typeof globalThis & { __imgconvertDirectoryFiles: Map<string, number[]> }
    ).__imgconvertDirectoryFiles;
    return Object.fromEntries(files);
  });
  expect(saved["photo.webp"]).toEqual([7]);
  expectMagic(Buffer.from(saved["photo (2).webp"] ?? []), "webp");
  expectMagic(Buffer.from(saved["other.webp"] ?? []), "webp");
});

test("cancels ZIP worker startup and recovers with a fresh archive worker", async ({ page }) => {
  await disablePwaForRequestInterception(page);
  let releaseFirstArchiveWorker: (() => void) | undefined;
  let reachedFirstArchiveWorker: (() => void) | undefined;
  const firstArchiveWorkerReached = new Promise<void>((resolve) => {
    reachedFirstArchiveWorker = resolve;
  });
  const firstArchiveWorkerRelease = new Promise<void>((resolve) => {
    releaseFirstArchiveWorker = resolve;
  });
  let firstArchiveWorker = true;
  await page.route(/archive\.worker-[^/]+\.js$/u, async (route) => {
    if (firstArchiveWorker) {
      firstArchiveWorker = false;
      reachedFirstArchiveWorker?.();
      await firstArchiveWorkerRelease;
    }
    await route.continue().catch(() => undefined);
  });

  await page.goto("?lang=en");
  const archiveInputs = Array.from({ length: 12 }, (_, index) => ({
    buffer: testPng(8 + index, 6 + index),
    mimeType: "image/png",
    name: `cancel-${String(index + 1).padStart(2, "0")}.png`,
  }));
  await page.locator('input[type="file"]').setInputFiles(archiveInputs);
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to configure" })).toHaveCount(
    archiveInputs.length,
  );
  await convertButton(page).click();
  await expect(page.locator(".queue-item").filter({ hasText: "Ready to download" })).toHaveCount(
    archiveInputs.length,
    { timeout: 90_000 },
  );
  const batch = page.getByRole("region", { name: "Export the Batch" });
  await batch.getByRole("button", { name: "Download ZIP" }).click();
  await firstArchiveWorkerReached;
  await batch.getByRole("button", { name: "Cancel Export" }).click();
  releaseFirstArchiveWorker?.();
  await expect(batch).toContainText("Batch export cancelled");

  const downloadPromise = page.waitForEvent("download");
  await batch.getByRole("button", { name: "Download ZIP" }).click();
  const entries = storedZipEntries(await downloadBytes(await downloadPromise));
  expect(entries.size).toBe(archiveInputs.length);
  expect(entries.has("cancel-01.webp")).toBe(true);
  expect(entries.has("cancel-12.webp")).toBe(true);
  await expect(batch).toContainText("ZIP download started");
});

test("rejects active, encrypted, and oversized PDF content", async ({ baseURL, page }) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPdf([{ height: 54, width: 72 }], { javaScript: true }),
    mimeType: "application/pdf",
    name: "active.pdf",
  });
  let queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(queueItem).toContainText("document JavaScript", { timeout: 90_000 });
  await clearQueue(page);

  await page.locator('input[type="file"]').setInputFiles({
    buffer: await encryptedPdf(),
    mimeType: "application/pdf",
    name: "encrypted.pdf",
  });
  queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Encrypted PDF files are not supported", {
    timeout: 90_000,
  });
  await clearQueue(page);

  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPdf([
      { height: 54, width: 72 },
      { height: 10_000, width: 10_000 },
    ]),
    mimeType: "application/pdf",
    name: "oversized-page.pdf",
  });
  queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await page.getByRole("textbox", { name: "Pages" }).fill("1-2");
  await page.getByRole("spinbutton", { name: "Render DPI" }).fill("72");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await expect(queueItem).toContainText("1 page ready");
  await expect(queueItem).toContainText("1 Page failed");
  await expect(queueItem).toContainText("browser budget");
  expect(externalRequests).toEqual([]);
  await clearQueue(page);
});

test("cancels PDF worker startup and recovers with a fresh worker", async ({ page }) => {
  await disablePwaForRequestInterception(page);
  let releaseFirstPdfWorker: (() => void) | undefined;
  let reachedFirstPdfWorker: (() => void) | undefined;
  const firstPdfWorkerReached = new Promise<void>((resolve) => {
    reachedFirstPdfWorker = resolve;
  });
  const firstPdfWorkerRelease = new Promise<void>((resolve) => {
    releaseFirstPdfWorker = resolve;
  });
  let firstPdfWorker = true;
  await page.route(/pdf-codec\.worker-[^/]+\.js$/u, async (route) => {
    if (firstPdfWorker) {
      firstPdfWorker = false;
      reachedFirstPdfWorker?.();
      await firstPdfWorkerRelease;
    }
    await route.continue().catch(() => undefined);
  });

  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPdf(),
    mimeType: "application/pdf",
    name: "cancel-pages.pdf",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await firstPdfWorkerReached;
  await page.getByRole("button", { name: "Cancel Conversion" }).click();
  releaseFirstPdfWorker?.();
  await expect(queueItem).toContainText("Cancelled", { timeout: 15_000 });

  await queueItem.getByRole("button", { name: /Check Again/u }).click();
  await expect(queueItem).toContainText("Ready to configure");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await clearQueue(page);
});

test("rejects active and externally linked SVG before rendering", async ({ baseURL, page }) => {
  const allowedOrigin = new URL(baseURL ?? page.url()).origin;
  const externalRequests: string[] = [];
  const wasmRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".wasm")) wasmRequests.push(url.pathname);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles([
    {
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><script>alert(1)</script></svg>',
      ),
      mimeType: "image/svg+xml",
      name: "script.svg",
    },
    {
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><image href="https://example.com/tracker.png"/></svg>',
      ),
      mimeType: "image/svg+xml",
      name: "linked.svg",
    },
  ]);

  const queueItems = page.locator(".queue-item");
  await expect(queueItems).toHaveCount(2);
  await expect(queueItems.filter({ hasText: "Needs attention" })).toHaveCount(2);
  await expect(queueItems.first()).toContainText("unsupported or unsafe content");
  expect(wasmRequests.some((path) => path.includes("index_bg-"))).toBe(false);
  expect(externalRequests).toEqual([]);
  await clearQueue(page);
});

test("cancels SVG initialization and recovers with a fresh Worker", async ({ page }) => {
  await disablePwaForRequestInterception(page);
  let releaseFirstWasm: (() => void) | undefined;
  let reachedFirstWasm: (() => void) | undefined;
  const firstWasmReached = new Promise<void>((resolve) => {
    reachedFirstWasm = resolve;
  });
  const firstWasmRelease = new Promise<void>((resolve) => {
    releaseFirstWasm = resolve;
  });
  let firstWasm = true;
  await page.route(/index_bg-[^/]+\.wasm$/u, async (route) => {
    if (firstWasm) {
      firstWasm = false;
      reachedFirstWasm?.();
      await firstWasmRelease;
    }
    await route.continue().catch(() => undefined);
  });

  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: safeSvg(320, 180),
    mimeType: "image/svg+xml",
    name: "cancel-vector.svg",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await firstWasmReached;
  await page.getByRole("button", { name: "Cancel Conversion" }).click();
  releaseFirstWasm?.();
  await expect(queueItem).toContainText("Cancelled", { timeout: 15_000 });

  await queueItem.getByRole("button", { name: /Check Again/u }).click();
  await expect(queueItem).toContainText("Ready to configure");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await clearQueue(page);
});

test("normalizes EXIF orientation and strips source metadata", async ({ page }) => {
  await page.goto("?lang=en");
  const jpeg = await convertOne(page, testPng(), "orientation-seed.png", "jpeg");
  const oriented = jpegWithOrientationAndXmp(jpeg);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: oriented,
    mimeType: "image/jpeg",
    name: "oriented.jpg",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await expect(queueItem).toContainText("6 × 8");

  const downloadPromise = page.waitForEvent("download");
  await queueItem.getByRole("button", { name: /Download Result/u }).click();
  const output = await downloadBytes(await downloadPromise);
  expectMagic(output, "png");
  expect(output.includes(Buffer.from("IMGCONVERT_METADATA_WEB_005"))).toBe(false);
  expect(output.includes(Buffer.from("Exif"))).toBe(false);
  await clearQueue(page);
});

test("cancels an active Worker and recovers for the next conversion", async ({ page }) => {
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    // Keep the AVIF job alive long enough for every browser engine to exercise
    // cancellation instead of racing a sub-200 ms encode to completion.
    buffer: testPng(1024, 768),
    mimeType: "image/png",
    name: "cancel.png",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "avif");
  await convertButton(page).click();
  await expect(page.getByRole("button", { name: "Cancel Conversion" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancel Conversion" }).click();
  await expect(queueItem).toContainText("Cancelled", { timeout: 15_000 });
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);

  await queueItem.getByRole("button", { name: /Check Again/u }).click();
  await expect(queueItem).toContainText("Ready to configure");
  await selectOutputFormat(page, "png");
  await convertButton(page).click();
  await expect(queueItem).toContainText("Ready to download", { timeout: 90_000 });
  await clearQueue(page);
});

test("shows actionable failures and rejects an unsafe resize", async ({ page }) => {
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("not an image"),
    mimeType: "text/plain",
    name: "notes.txt",
  });
  const queueItem = page.locator(".queue-item");
  await expect(queueItem).toContainText("not a supported Web image");
  await expect(queueItem).not.toContainText("not an image");
  await queueItem.getByRole("button", { name: /Check Again/u }).click();
  await expect(queueItem).toContainText("not a supported Web image");
  await clearQueue(page);

  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "resize.png",
  });
  await expect(page.locator(".queue-item")).toContainText("Ready to configure");
  await page.getByLabel("Image size").selectOption("custom");
  await page.getByRole("spinbutton", { name: "Width" }).fill("8000");
  await page.getByRole("spinbutton", { name: "Height" }).fill("4000");
  await expect(page.getByText(/24 MP browser budget/u)).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByRole("spinbutton", { name: "Height" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(convertButton(page)).toBeDisabled();
});

test("keeps the 375 px layout inside the viewport and exposes keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("?lang=en");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  const settingsStep = page.getByRole("link", { name: "Output Setup" });
  await expect(settingsStep).toHaveAttribute("href", "#sl-settings");
  await settingsStep.click();
  await expect(page).toHaveURL(/#sl-settings$/u);
  const themeButton = page.getByRole("button", { name: "Use Dark Theme" });
  await expect(themeButton).toBeVisible();
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(convertButton(page)).toBeDisabled();

  for (const viewport of [
    { height: 1024, width: 768 },
    { height: 900, width: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector("header")?.getBoundingClientRect();
      const workbench = document.querySelector("main")?.getBoundingClientRect();
      return {
        headerLeft: header?.left ?? -1,
        headerRight: header?.right ?? innerWidth + 1,
        overflow: document.documentElement.scrollWidth - innerWidth,
        workbenchLeft: workbench?.left ?? -1,
        workbenchRight: workbench?.right ?? innerWidth + 1,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(0);
    expect(geometry.headerLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.headerRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.workbenchLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.workbenchRight).toBeLessThanOrEqual(viewport.width);
  }
});

test("keeps the import queue beside the workbench and sticky on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "sticky-queue.png",
  });
  await expect(page.locator(".queue-item")).toContainText("Ready to configure");
  await expect(page.locator("#sl-import")).toHaveCSS("transform", "none");

  const initial = await page.evaluate(() => {
    const importSection = document.querySelector("#sl-import")?.getBoundingClientRect();
    const queueRail = document.querySelector(".v-softlab-queue-rail")?.getBoundingClientRect();
    return {
      importTop: importSection?.top ?? -1,
      importRight: importSection?.right ?? -1,
      queueLeft: queueRail?.left ?? -1,
      queueTop: queueRail?.top ?? -1,
      queueVisible: (queueRail?.bottom ?? innerHeight + 1) <= innerHeight,
    };
  });
  expect(initial.queueLeft).toBeGreaterThan(initial.importRight);
  expect(Math.abs(initial.queueTop - initial.importTop)).toBeLessThanOrEqual(1);
  expect(initial.queueVisible).toBe(true);

  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 8 }, (_, index) => ({
      buffer: testPng(),
      mimeType: "image/png",
      name: `queue-${index + 1}.png`,
    })),
  );
  await expect(page.locator(".queue-item")).toHaveCount(9);

  await page.evaluate(() => window.scrollTo({ top: 500 }));
  await expect
    .poll(async () =>
      page
        .locator(".v-softlab-queue-rail")
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    )
    .toBeGreaterThanOrEqual(80);
  await expect
    .poll(async () =>
      page
        .locator(".v-softlab-queue-rail")
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    )
    .toBeLessThanOrEqual(100);
  const scrolled = await page.evaluate(() => {
    const queueRail = document.querySelector(".v-softlab-queue-rail")?.getBoundingClientRect();
    const queueList = document.querySelector(".queue-list");
    return {
      listClientHeight: queueList?.clientHeight ?? -1,
      listOverflow: queueList ? getComputedStyle(queueList).overflowY : "",
      listScrollHeight: queueList?.scrollHeight ?? -1,
      queueBottom: queueRail?.bottom ?? innerHeight + 1,
    };
  });
  expect(scrolled.queueBottom).toBeLessThanOrEqual(900);
  expect(scrolled.listOverflow).toBe("auto");
  expect(scrolled.listScrollHeight).toBeGreaterThan(scrolled.listClientHeight);
  await expect(page.locator(".queue-item").first()).toBeInViewport();
});

test("places the import queue immediately after the dropzone on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("?lang=en");
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "mobile-queue.png",
  });
  await expect(page.locator(".queue-item")).toContainText("Ready to configure");

  const order = await page.evaluate(() => {
    const importSection = document.querySelector("#sl-import")?.getBoundingClientRect();
    const queueRail = document.querySelector(".v-softlab-queue-rail")?.getBoundingClientRect();
    const settingsSection = document.querySelector("#sl-settings")?.getBoundingClientRect();
    return {
      importBottom: importSection?.bottom ?? -1,
      queueBottom: queueRail?.bottom ?? -1,
      queueTop: queueRail?.top ?? -1,
      settingsTop: settingsSection?.top ?? -1,
    };
  });
  expect(order.queueTop).toBeGreaterThan(order.importBottom);
  expect(order.settingsTop).toBeGreaterThan(order.queueBottom);
  await expect(page.locator(".v-softlab-queue-rail")).toHaveCSS("position", "static");
  await expect(page.locator(".queue-item")).toBeInViewport();
});

test("still starts when browser preference storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.goto("?lang=en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Convert images");
  await page.getByRole("button", { name: "Use Dark Theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("installs a /convert/-scoped PWA without precaching optional engines", async ({ page }) => {
  await page.goto("?lang=en");
  await waitForOfflineTools(page);

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/convert/manifest.webmanifest",
  );
  const manifest = await page.evaluate(async () => {
    const response = await fetch("/convert/manifest.webmanifest");
    return response.json() as Promise<Record<string, unknown>>;
  });
  expect(manifest).toMatchObject({
    display: "standalone",
    id: "/convert/",
    scope: "/convert/",
    start_url: "/convert/",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
    ]),
  );

  const registrationBoundary = await page.evaluate(async () => {
    const current = await navigator.serviceWorker.getRegistration("/convert/");
    const marketing = await navigator.serviceWorker.getRegistration("/");
    const docs = await navigator.serviceWorker.getRegistration("/docs/");
    return {
      currentScope: current?.scope,
      docsControlled: docs !== undefined,
      marketingControlled: marketing !== undefined,
    };
  });
  expect(registrationBoundary.currentScope).toBe(new URL("/convert/", page.url()).href);
  expect(registrationBoundary.marketingControlled).toBe(false);
  expect(registrationBoundary.docsControlled).toBe(false);

  const cached = await pwaCacheRequests(page);
  expect(cached.some((url) => url.endsWith("/convert/"))).toBe(true);
  expect(cached.some((url) => /\/convert\/assets\/index-[^/]+\.(?:css|js)$/u.test(url))).toBe(true);
  expect(cached.every((url) => new URL(url).pathname.startsWith("/convert/"))).toBe(true);
  expect(cached.some((url) => /\.wasm$|\.worker-/u.test(url))).toBe(false);
});

test("converts with a cached raster engine after the browser goes offline", async ({
  browserName,
  context,
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("?lang=en");
  await waitForOfflineTools(page);
  await page.locator('input[type="file"]').setInputFiles({
    buffer: testPng(),
    mimeType: "image/png",
    name: "online-primer.png",
  });
  await expect(page.locator(".queue-item")).toContainText("Ready to configure");
  await selectOutputFormat(page, "webp");
  await convertButton(page).click();
  await expect(page.locator(".queue-item")).toContainText("Ready to download", {
    timeout: 90_000,
  });
  await clearQueue(page);

  const warmed = await pwaCacheRequests(page);
  expect(warmed.some((url) => /raster-codec\.worker-/u.test(url))).toBe(true);
  expect(warmed.some((url) => /(?:squoosh_png|webp_(?:dec|enc))[^/]*\.wasm$/u.test(url))).toBe(
    true,
  );
  expect(warmed.some((url) => /(?:avif_|pdf|svg-codec|archive\.worker)/u.test(url))).toBe(false);

  const webkitBlockedRequests: string[] = [];
  if (browserName === "webkit") {
    await page.locator('input[type="file"]').setInputFiles({
      buffer: testPng(6, 4),
      mimeType: "image/png",
      name: "offline-private.png",
    });
    await expect(page.locator(".queue-item")).toContainText("Ready to configure");
    // Playwright's WebKit offline toggle also blocks local blob: URLs, which real network loss
    // does not. Abort HTTP(S) instead so the offline conversion still exercises local bytes.
    await context.route(/^https?:\/\//u, async (route) => {
      webkitBlockedRequests.push(route.request().url());
      await route.abort("internetdisconnected");
    });
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  } else {
    await context.setOffline(true);
  }
  const offlinePage = page;
  try {
    if (browserName !== "webkit") {
      await page.reload({ waitUntil: "domcontentloaded" });
    } else {
      test.info().annotations.push({
        description:
          "Playwright WebKit blocks blob: URLs in setOffline mode; HTTP(S) is blocked without changing local blob handling.",
        type: "harness-limitation",
      });
    }
    await expect(offlinePage.getByRole("heading", { level: 1 })).toContainText("Convert images");
    await expect(offlinePage.getByText("Offline", { exact: true })).toBeVisible();
    if (browserName !== "webkit") {
      await offlinePage.locator('input[type="file"]').setInputFiles({
        buffer: testPng(6, 4),
        mimeType: "image/png",
        name: "offline-private.png",
      });
      await expect(offlinePage.locator(".queue-item")).toContainText("Ready to configure");
    }
    await convertButton(offlinePage).click();
    await expect(offlinePage.locator(".queue-item")).toContainText("Ready to download", {
      timeout: 90_000,
    });
    await expect(offlinePage.locator(".queue-item")).toContainText("WebP");
  } finally {
    if (browserName === "webkit") {
      await context.unroute(/^https?:\/\//u);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
    } else {
      await context.setOffline(false);
    }
  }

  expect(webkitBlockedRequests).toEqual([]);
  expect((await pwaCacheRequests(offlinePage)).join("\n")).not.toContain("offline-private.png");
});

test("keeps a service worker update waiting until the user applies it", async ({ page }) => {
  await page.goto("?lang=en");
  await waitForOfflineTools(page);
  await page.evaluate(async () => {
    const stale = await caches.open("imgconvert-web:web-v0-protocol:stale:shell");
    await stale.put("/convert/stale-shell", new Response("stale"));
    const unrelated = await caches.open("another-product-cache");
    await unrelated.put("/unrelated", new Response("keep"));
  });
  const originalController = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? "",
  );
  expect(originalController).toMatch(/\/convert\/service-worker\.js$/u);

  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/convert/service-worker.js?e2e-update=1", {
      scope: "/convert/",
      updateViaCache: "none",
    });
  });
  await expect(page.getByText("A new version is ready")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toBe(
    originalController,
  );

  const reload = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await page.getByRole("button", { name: "Update & Reload" }).click();
  await reload;
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Convert images");
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toEqual(expect.not.arrayContaining(["imgconvert-web:web-v0-protocol:stale:shell"]));
  expect(await page.evaluate(() => caches.keys())).toContain("another-product-cache");
});

test("clears only saved settings and ImgConvert offline caches after confirmation", async ({
  page,
}) => {
  await page.goto("?lang=en");
  await waitForOfflineTools(page);
  await page.getByRole("button", { name: "Use Dark Theme" }).click();
  await page.getByLabel("Image size").selectOption("custom");
  await page.getByRole("spinbutton", { name: "Width" }).fill("640");
  await page.evaluate(async () => {
    const unrelated = await caches.open("another-product-cache");
    await unrelated.put("/unrelated", new Response("keep"));
  });
  await expect.poll(async () => page.evaluate(() => localStorage.length)).toBeGreaterThan(0);
  expect((await pwaCacheRequests(page)).length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Clear Local Data" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear Local Settings & Offline Cache?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear Local Data" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Local settings and offline cache cleared")).toBeVisible();

  const localKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(localKeys.filter((key) => key.startsWith("imgconvert-web-"))).toEqual([]);
  expect(await pwaCacheRequests(page)).toEqual([]);
  expect(await page.evaluate(() => caches.keys())).toContain("another-product-cache");
  await expect(page.getByLabel("Image size")).toHaveValue("original");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(?:dark|light)$/u);
});
