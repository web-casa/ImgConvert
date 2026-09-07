// SPDX-License-Identifier: Apache-2.0
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browser = process.argv
  .find((argument) => argument.startsWith("--browser="))
  ?.slice("--browser=".length);

if (browser !== "chrome" && browser !== "edge") {
  throw new Error("Expected --browser=chrome or --browser=edge");
}

const configuredExecutable =
  browser === "edge"
    ? process.env.IMGCONVERT_EDGE_EXECUTABLE
    : process.env.IMGCONVERT_CHROMIUM_EXECUTABLE;
const fallbackExecutable = browser === "chrome" ? "/usr/bin/chromium" : undefined;
const executablePath = configuredExecutable ?? fallbackExecutable;
if (executablePath === undefined) {
  throw new Error(
    browser === "edge"
      ? "Set IMGCONVERT_EDGE_EXECUTABLE to a Chromium Edge binary"
      : "Set IMGCONVERT_CHROMIUM_EXECUTABLE to a Chrome or Chromium binary",
  );
}

await access(executablePath);
const currentBuildPath = join(projectRoot, ".output", `${browser}-mv3`);
await access(join(currentBuildPath, "manifest.json"));

const temporaryRoot = await mkdtemp(join(tmpdir(), `imgconvert-${browser}-update-`));
const profilePath = join(temporaryRoot, "profile");
const stagedExtensionPath = join(temporaryRoot, "extension");
const errors = [];

function previousVersion(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error(`Cannot derive the update fixture version from ${version}`);
  }
  if ((parts[2] ?? 0) > 0) parts[2] -= 1;
  else if ((parts[1] ?? 0) > 0) {
    parts[1] -= 1;
    parts[2] = 999;
  } else {
    throw new Error(`Extension version ${version} has no safe earlier fixture version`);
  }
  return parts.slice(0, 3).join(".");
}

async function stageBuild({ legacy }) {
  await rm(stagedExtensionPath, { force: true, recursive: true });
  await mkdir(stagedExtensionPath, { recursive: true });
  await cp(currentBuildPath, stagedExtensionPath, { recursive: true });
  const manifestPath = join(stagedExtensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!legacy) return manifest;

  manifest.version = previousVersion(manifest.version);
  delete manifest.version_name;
  manifest.background.service_worker = "legacy-background.js";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    join(stagedExtensionPath, "legacy-background.js"),
    "chrome.runtime.onInstalled.addListener(() => undefined);\n",
    "utf8",
  );
  return manifest;
}

async function launch() {
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [
      `--disable-extensions-except=${stagedExtensionPath}`,
      `--load-extension=${stagedExtensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    executablePath,
    headless: false,
  });
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  });
  let workers = context.serviceWorkers();
  if (workers.length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 15_000 });
    workers = context.serviceWorkers();
  }
  if (workers.length !== 1) throw new Error(`Expected one service worker, found ${workers.length}`);
  workers[0].on("console", (message) => {
    if (message.type() === "error") errors.push(`worker console: ${message.text()}`);
  });
  return { context, worker: workers[0] };
}

let legacyContext;
let updatedContext;
try {
  const legacyManifest = await stageBuild({ legacy: true });
  let legacyWorker;
  ({ context: legacyContext, worker: legacyWorker } = await launch());
  const legacyExtensionId = new URL(legacyWorker.url()).host;
  await legacyWorker.evaluate(async () => {
    await chrome.storage.local.set({
      "imgconvert.preferences": {
        files: [{ bytes: "data:image/png;base64,private", name: "private.png" }],
        history: ["private.png"],
        jpegBackground: "#AABBCC",
        locale: "zh",
        lossless: false,
        outputFormat: "jpeg",
        pdfDpi: 144,
        pdfPageRange: "1-2",
        quality: 73,
        resizeHeight: 720,
        resizeMode: "custom",
        resizeWidth: 1280,
        schemaVersion: 1,
        sourceUrl: "https://private.test/private.png",
        theme: "dark",
      },
      "imgconvert.preferences$": { v: 1 },
      "unrelated.local": "keep",
    });
    await chrome.storage.session.set({
      "imgconvert.converterTab.7": 42,
      "imgconvert.pendingImport.7": {
        kind: "remote",
        sourceUrl: "https://private.test/private.png",
      },
      "unrelated.session": "keep",
    });
  });
  await legacyContext.close();
  legacyContext = undefined;
  const currentManifest = await stageBuild({ legacy: false });
  if (legacyManifest.version === currentManifest.version) {
    throw new Error("Update smoke requires distinct legacy and current manifest versions");
  }
  let updatedWorker;
  ({ context: updatedContext, worker: updatedWorker } = await launch());
  const extensionUrl = new URL(updatedWorker.url());
  if (extensionUrl.host !== legacyExtensionId) {
    throw new Error(
      `Unpacked extension ID changed across the update: ${legacyExtensionId} → ${extensionUrl.host}`,
    );
  }
  const loadedManifestVersion = await updatedWorker.evaluate(
    () => chrome.runtime.getManifest().version,
  );
  if (loadedManifestVersion !== currentManifest.version) {
    throw new Error(
      `Updated browser loaded manifest ${loadedManifestVersion}, expected ${currentManifest.version}`,
    );
  }
  const extensionOrigin = `${extensionUrl.protocol}//${extensionUrl.host}`;
  const page = await updatedContext.newPage();
  const networkRequests = [];
  page.on("request", (request) => {
    if (/^https?:/iu.test(request.url())) networkRequests.push(request.url());
  });
  await page.goto(`${extensionOrigin}/converter.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#workspace").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      globalThis.document.querySelector(".extension-shell")?.getAttribute("data-theme") ===
        "dark" && globalThis.document.documentElement.lang === "zh-CN",
  );
  if (!(await page.locator('input[name="outputFormat"][value="jpeg"]').isChecked())) {
    throw new Error("Upgraded workbench did not restore the stored JPEG preference");
  }
  if ((await page.locator('input[name="quality"]').inputValue()) !== "73") {
    throw new Error("Upgraded workbench did not restore the stored quality preference");
  }

  await page.waitForFunction(async () => {
    const values = await chrome.storage.local.get(["imgconvert.preferences$"]);
    return values["imgconvert.preferences$"]?.v === 2;
  });
  await page.waitForFunction(async () => {
    const values = await chrome.storage.session.get(null);
    return !Object.keys(values).some(
      (key) =>
        key.startsWith("imgconvert.converterTab.") || key.startsWith("imgconvert.pendingImport."),
    );
  });

  const stored = await page.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  const migratedPreferences = stored.local["imgconvert.preferences"];
  if (
    migratedPreferences?.locale !== "zh" ||
    migratedPreferences?.theme !== "dark" ||
    migratedPreferences?.outputFormat !== "jpeg" ||
    migratedPreferences?.quality !== 73 ||
    migratedPreferences?.resizeMode !== "custom" ||
    migratedPreferences?.resizeWidth !== 1280 ||
    migratedPreferences?.resizeHeight !== 720
  ) {
    throw new Error(`Preference migration lost valid settings: ${JSON.stringify(stored.local)}`);
  }
  if (stored.local["unrelated.local"] !== "keep") {
    throw new Error("Extension update removed unrelated local storage");
  }
  const serializedStorage = JSON.stringify(stored);
  for (const forbiddenContent of [
    "data:image",
    "files",
    "history",
    "pendingImport",
    "private.png",
    "private.test",
    "sourceUrl",
  ]) {
    if (serializedStorage.includes(forbiddenContent)) {
      throw new Error(`Extension update retained forbidden content: ${forbiddenContent}`);
    }
  }
  if (networkRequests.length > 0) {
    throw new Error(`Upgraded extension page made remote requests: ${networkRequests.join(", ")}`);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  console.log(
    `${browser}: same-ID unpacked restart update ${legacyManifest.version} → ${currentManifest.version} preserved canonical preferences, retained unrelated local storage, left no session content, and made no remote requests`,
  );
} finally {
  await legacyContext?.close().catch(() => undefined);
  await updatedContext?.close().catch(() => undefined);
  await rm(temporaryRoot, { force: true, recursive: true });
}
