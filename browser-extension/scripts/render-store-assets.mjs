// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const assetRoot = join(projectRoot, "store", "assets", `v${version}`);
const sharedRoot = join(assetRoot, "shared");
const extensionIconPath = join(projectRoot, "public", "icon", "128.png");
const productIconPath = join(repositoryRoot, "src-tauri", "icons", "icon.png");
const sampleInputs = [
  {
    mimeType: "image/png",
    name: "studio-photo.png",
    path: join(repositoryRoot, "website", "public", "images", "generated", "local-atelier.png"),
  },
  {
    mimeType: "image/webp",
    name: "private-workspace.webp",
    path: join(repositoryRoot, "website", "public", "images", "generated", "private-vault.webp"),
  },
];
const provenanceSources = [
  {
    name: "app-icon.png",
    path: productIconPath,
    purpose: "graphics",
  },
  ...sampleInputs.map((input) => ({ ...input, purpose: "screenshots" })),
];
const requestedMode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice(7);
const mode = requestedMode ?? "all";

if (!["all", "graphics", "screenshots"].includes(mode)) {
  throw new Error("Expected --mode=all, --mode=graphics, or --mode=screenshots");
}

for (const path of [assetRoot, sharedRoot]) await mkdir(path, { recursive: true });

const previousProvenance = await readPreviousProvenance();
const provenance = {
  assetSchemaVersion: 2,
  browser: previousProvenance?.browser,
  build: previousProvenance?.build,
  generatedAt: new Date().toISOString(),
  productVersion: version,
  sources: [],
};

if (mode === "all" || mode === "graphics") await renderGraphics();
if (mode === "all" || mode === "screenshots") await captureScreenshots();

provenance.sources = (
  await Promise.all(
    provenanceSources.map((source) =>
      sourceEvidence(
        source,
        mode === "all" ||
          (source.purpose === "graphics" ? mode === "graphics" : mode === "screenshots"),
        previousProvenance,
      ),
    ),
  )
).filter(Boolean);

const assets = await filesUnder(assetRoot);
provenance.assets = await Promise.all(
  assets
    .filter((path) => !path.endsWith("provenance.json"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map(async (path) => ({
      bytes: (await readFile(path)).byteLength,
      path: relative(assetRoot, path).split(sep).join("/"),
      sha256: await sha256File(path),
    })),
);
await writeFile(
  join(assetRoot, "provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
  "utf8",
);

console.log(`Rendered browser-extension store assets in ${relative(repositoryRoot, assetRoot)}`);

async function renderGraphics() {
  await access(productIconPath);
  const productIcon = toDataUrl(await readFile(productIconPath), "image/png");
  const browser = await chromium.launch();
  try {
    await renderCanvas(browser, {
      height: 128,
      html: `<img src="${productIcon}" alt="" />`,
      output: extensionIconPath,
      style:
        "html,body{margin:0;width:128px;height:128px;background:transparent;overflow:hidden}body{display:grid;place-items:center}img{display:block;width:96px;height:96px;border-radius:22%}",
      transparent: true,
      width: 128,
    });
    await renderCanvas(browser, {
      height: 128,
      html: `<img src="${productIcon}" alt="" />`,
      output: join(sharedRoot, "chrome-store-icon-128.png"),
      style:
        "html,body{margin:0;width:128px;height:128px;background:transparent;overflow:hidden}body{display:grid;place-items:center}img{display:block;width:96px;height:96px;border-radius:22%}",
      transparent: true,
      width: 128,
    });
    await renderCanvas(browser, {
      height: 300,
      html: `<img src="${productIcon}" alt="" />`,
      output: join(sharedRoot, "edge-store-logo-300.png"),
      style:
        "html,body{margin:0;width:300px;height:300px;background:transparent;overflow:hidden}body{display:grid;place-items:center}img{display:block;width:225px;height:225px;border-radius:22%}",
      transparent: true,
      width: 300,
    });
    await renderPromo(browser, 440, 280, join(sharedRoot, "small-promo-440x280.png"), productIcon);
    await renderPromo(
      browser,
      1400,
      560,
      join(sharedRoot, "marquee-promo-1400x560.png"),
      productIcon,
    );
  } finally {
    await browser.close();
  }
}

async function renderPromo(browser, width, height, output, productIcon) {
  const scale = width / 440;
  const iconSize = Math.round(118 * Math.min(scale, 1.75));
  const tileSize = Math.round(88 * Math.min(scale, 2));
  const html = `
    <div class="halo halo-a"></div><div class="halo halo-b"></div>
    <div class="sheet sheet-a"></div><div class="sheet sheet-b"></div><div class="sheet sheet-c"></div>
    <div class="icon"><img src="${productIcon}" alt="" /></div>
    <div class="route" aria-hidden="true"><span></span><i></i><span></span></div>
  `;
  const style = `
    *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#173825}
    body{position:relative;font-family:system-ui,sans-serif}
    .halo{position:absolute;border-radius:999px;border:${Math.max(20, Math.round(33 * scale))}px solid rgba(241,233,214,.13)}
    .halo-a{width:${Math.round(246 * scale)}px;height:${Math.round(246 * scale)}px;left:${Math.round(-72 * scale)}px;top:${Math.round(-82 * scale)}px}
    .halo-b{width:${Math.round(310 * scale)}px;height:${Math.round(310 * scale)}px;right:${Math.round(-118 * scale)}px;bottom:${Math.round(-150 * scale)}px;border-color:rgba(184,220,89,.18)}
    .sheet{position:absolute;width:${tileSize}px;height:${Math.round(tileSize * 0.72)}px;border:1px solid rgba(246,242,231,.45);border-radius:${Math.round(12 * scale)}px;background:linear-gradient(145deg,#f4ecd9,#d6e4bd);box-shadow:0 ${Math.round(15 * scale)}px ${Math.round(35 * scale)}px rgba(6,25,16,.25)}
    .sheet::after{content:"";position:absolute;inset:${Math.round(10 * scale)}px;border-radius:${Math.round(7 * scale)}px;background:linear-gradient(145deg,#ee7657 0 28%,#80aa55 28% 67%,#f2cf67 67%)}
    .sheet-a{left:${Math.round(44 * scale)}px;bottom:${Math.round(42 * scale)}px;transform:rotate(-9deg)}
    .sheet-b{right:${Math.round(47 * scale)}px;top:${Math.round(39 * scale)}px;transform:rotate(7deg)}
    .sheet-c{right:${Math.round(74 * scale)}px;bottom:${Math.round(29 * scale)}px;transform:rotate(-4deg)}
    .icon{position:absolute;left:50%;top:50%;display:grid;width:${Math.round(iconSize * 1.24)}px;height:${Math.round(iconSize * 1.24)}px;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:${Math.round(iconSize * 0.31)}px;background:rgba(246,242,231,.11);box-shadow:0 ${Math.round(24 * scale)}px ${Math.round(56 * scale)}px rgba(5,23,14,.34);transform:translate(-50%,-50%);backdrop-filter:blur(${Math.round(10 * scale)}px)}
    .icon img{display:block;width:${iconSize}px;height:${iconSize}px;border-radius:22%}
    .route{position:absolute;left:50%;bottom:${Math.round(18 * scale)}px;display:flex;align-items:center;gap:${Math.round(8 * scale)}px;transform:translateX(-50%)}
    .route span{width:${Math.round(8 * scale)}px;height:${Math.round(8 * scale)}px;border-radius:99px;background:#b8dc59}
    .route i{display:block;width:${Math.round(48 * scale)}px;height:2px;background:#f1e9d6;opacity:.8}
  `;
  await renderCanvas(browser, { height, html, output, style, transparent: false, width });
}

async function captureScreenshots() {
  const buildRoot = join(projectRoot, ".output", "chrome-mv3");
  const manifest = JSON.parse(await readFile(join(buildRoot, "manifest.json"), "utf8"));
  if (manifest.version !== version)
    throw new Error("Chrome build version is not the store version");
  if (JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://*/*"])) {
    throw new Error("Store screenshots require the HTTPS-only manifest");
  }
  for (const input of sampleInputs) await access(input.path);

  const executablePath =
    process.env.IMGCONVERT_CHROME_EXECUTABLE ??
    process.env.IMGCONVERT_CHROMIUM_EXECUTABLE ??
    "/usr/bin/chromium";
  await access(executablePath);
  const profilePath = await mkdtemp(join(tmpdir(), "imgconvert-store-assets-"));
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [
      `--disable-extensions-except=${buildRoot}`,
      `--load-extension=${buildRoot}`,
      "--no-default-browser-check",
      "--no-first-run",
    ],
    colorScheme: "light",
    executablePath,
    headless: false,
    locale: "en-US",
    viewport: { height: 800, width: 1280 },
  });
  const remoteRequests = [];
  try {
    const worker = await findExtensionWorker(context, manifest);
    const workerUrl = new URL(worker.url());
    const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
    const page = await context.newPage();
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url())) remoteRequests.push(request.url());
    });
    await page.goto(`${extensionOrigin}/converter.html`, { waitUntil: "domcontentloaded" });
    await page.locator("#workspace").waitFor({ state: "visible" });
    await page.locator('[data-testid="file-input"]').setInputFiles(
      await Promise.all(
        sampleInputs.map(async (input) => ({
          buffer: await readFile(input.path),
          mimeType: input.mimeType,
          name: input.name,
        })),
      ),
    );
    await page.waitForFunction(
      () =>
        [...globalThis.document.querySelectorAll('[data-testid="queue-state"]')].length === 2 &&
        [...globalThis.document.querySelectorAll('[data-testid="queue-state"]')].every(
          (element) => element.getAttribute("data-state") === "ready",
        ),
      undefined,
      { timeout: 60_000 },
    );
    await page.locator('[data-testid="convert-button"]').click();
    await page.waitForFunction(
      () =>
        [...globalThis.document.querySelectorAll('[data-testid="queue-state"]')].length === 2 &&
        [...globalThis.document.querySelectorAll('[data-testid="queue-state"]')].every(
          (element) => element.getAttribute("data-state") === "done",
        ),
      undefined,
      { timeout: 180_000 },
    );
    if (remoteRequests.length > 0) {
      throw new Error(`Store screenshot flow made remote requests: ${remoteRequests.join(", ")}`);
    }

    for (const locale of ["en-US", "zh-CN"]) {
      await ensureLocale(page, locale);
      await ensureTheme(page, "light");
      const localeRoot = join(assetRoot, locale);
      await mkdir(localeRoot, { recursive: true });

      await scrollTo(page, ".workbench-grid");
      await capturePage(page, join(localeRoot, "01-local-batch-converted.png"));

      await scrollTo(page, ".settings-panel");
      await capturePage(page, join(localeRoot, "02-output-controls.png"));

      await page.locator('[data-testid="preview-result"]').first().click();
      await page.locator("dialog.preview-dialog[open]").waitFor({ state: "visible" });
      await capturePage(page, join(localeRoot, "03-verified-preview.png"));
      await page.keyboard.press("Escape");

      await page.evaluate(() => scrollTo({ behavior: "instant", left: 0, top: 0 }));
      await capturePage(page, join(localeRoot, "04-local-first-overview.png"));

      await ensureTheme(page, "dark");
      await scrollTo(page, ".workbench-grid");
      await capturePage(page, join(localeRoot, "05-dark-workbench.png"));
      await ensureTheme(page, "light");
    }

    const { stderr, stdout } = await execFileAsync(executablePath, ["--version"]);
    provenance.browser = `${stdout}${stderr}`.trim();
    provenance.build = {
      manifestVersion: manifest.manifest_version,
      sha256: await directoryFingerprint(buildRoot),
      target: "chrome-mv3",
      version,
    };
  } finally {
    await context.close().catch(() => undefined);
    await rm(profilePath, { force: true, recursive: true });
  }
}

async function findExtensionWorker(context, manifest) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      try {
        const current = await worker.evaluate(() => chrome.runtime.getManifest());
        if (current.version === manifest.version && current.default_locale === "en") return worker;
      } catch {
        // The service worker can stop during inspection; retry its live registration.
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error("Timed out waiting for the ImgConvert extension service worker");
}

async function ensureLocale(page, locale) {
  const expected = locale === "zh-CN" ? "zh-CN" : "en";
  if ((await page.locator("html").getAttribute("lang")) !== expected) {
    await page.locator('[data-testid="locale-button"]').click();
    await page.locator(`html[lang="${expected}"]`).waitFor();
  }
}

async function ensureTheme(page, theme) {
  if ((await page.locator(".extension-shell").getAttribute("data-theme")) !== theme) {
    await page.locator('[data-testid="theme-button"]').click();
    await page.locator(`.extension-shell[data-theme="${theme}"]`).waitFor();
  }
}

async function scrollTo(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const top = element.getBoundingClientRect().top + globalThis.scrollY - 84;
    globalThis.scrollTo({ behavior: "instant", left: 0, top });
  });
  await page.waitForTimeout(80);
}

async function capturePage(page, output) {
  await page.evaluate(async () => globalThis.document.fonts.ready);
  await page.screenshot({ animations: "disabled", caret: "hide", path: output });
}

async function renderCanvas(browser, options) {
  await mkdir(dirname(options.output), { recursive: true });
  const page = await browser.newPage({
    viewport: { height: options.height, width: options.width },
  });
  try {
    await page.setContent(`<!doctype html><style>${options.style}</style>${options.html}`);
    await page.locator("img").first().waitFor({ state: "visible" });
    await page.screenshot({
      animations: "disabled",
      omitBackground: options.transparent,
      path: options.output,
    });
  } finally {
    await page.close();
  }
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function directoryFingerprint(directory) {
  const digest = createHash("sha256");
  const files = (await filesUnder(directory)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  for (const path of files) {
    digest.update(`${relative(directory, path).split(sep).join("/")}\0${await sha256File(path)}\n`);
  }
  return digest.digest("hex");
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function toDataUrl(bytes, mimeType) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function readPreviousProvenance() {
  try {
    const candidate = JSON.parse(await readFile(join(assetRoot, "provenance.json"), "utf8"));
    if (
      (candidate.assetSchemaVersion === 1 || candidate.assetSchemaVersion === 2) &&
      candidate.productVersion === version &&
      Array.isArray(candidate.sources)
    ) {
      return candidate;
    }
  } catch {
    // A graphics-only run may start before any screenshot provenance exists.
  }
  return undefined;
}

async function sourceEvidence(source, refreshed, previous) {
  const sourcePath = relative(repositoryRoot, source.path).split(sep).join("/");
  if (refreshed) {
    await access(source.path);
    return {
      name: source.name,
      path: sourcePath,
      purpose: source.purpose,
      sha256: await sha256File(source.path),
    };
  }
  const prior = previous?.sources?.find(
    (entry) => entry.path === sourcePath && entry.name === source.name,
  );
  return prior
    ? {
        name: source.name,
        path: sourcePath,
        purpose: source.purpose,
        sha256: prior.sha256,
      }
    : undefined;
}
