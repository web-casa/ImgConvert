// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PWA_CACHE_PREFIX, PWA_COMPATIBILITY_VERSION, PWA_SCOPE_PATH } from "../pwa.config.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(projectDirectory, "..");
const distributionDirectory = resolve(projectDirectory, "dist");
const assetsDirectory = resolve(distributionDirectory, "assets");
const iconDirectory = resolve(distributionDirectory, "icons");
const templatePath = resolve(projectDirectory, "pwa/service-worker.js");
const serviceWorkerPath = resolve(distributionDirectory, "service-worker.js");
const manifestPath = resolve(distributionDirectory, "manifest.webmanifest");
const sourceIcon192Path = resolve(projectDirectory, "pwa/icon-192.png");
const sourceIcon512Path = resolve(repositoryDirectory, "src-tauri/icons/icon.png");

function scopedUrl(relativePath) {
  return `${PWA_SCOPE_PATH}${relativePath}`;
}

function extractShellAssets(indexHtml) {
  const urls = new Set([PWA_SCOPE_PATH]);
  for (const match of indexHtml.matchAll(/(?:href|src)="(\/convert\/assets\/[^"]+)"/gu)) {
    const url = match[1];
    if (url) urls.add(url);
  }
  return urls;
}

function assertScopedUrls(urls) {
  for (const url of urls) {
    if (!url.startsWith(PWA_SCOPE_PATH) || url.includes("..") || /[?#]/u.test(url)) {
      throw new Error(`Unsafe PWA asset URL: ${url}`);
    }
  }
}

function assertPngDimensions(bytes, expectedWidth, expectedHeight, label) {
  const signature = bytes.subarray(0, 8).toString("hex");
  if (
    signature !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(16) !== expectedWidth ||
    bytes.readUInt32BE(20) !== expectedHeight
  ) {
    throw new Error(`${label} must be a ${expectedWidth} × ${expectedHeight} PNG.`);
  }
}

async function buildArtifacts() {
  const indexPath = resolve(distributionDirectory, "index.html");
  const [indexHtml, sourceIcon192, sourceIcon512, template] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(sourceIcon192Path),
    readFile(sourceIcon512Path),
    readFile(templatePath, "utf8"),
  ]);
  assertPngDimensions(sourceIcon192, 192, 192, "Small PWA icon");
  assertPngDimensions(sourceIcon512, 512, 512, "Large PWA icon");
  const assetNames = (await readdir(assetsDirectory)).sort();
  const shellAssets = extractShellAssets(indexHtml);
  const appIcon = assetNames.find((name) => /^app-icon-[A-Za-z0-9_-]+\.png$/u.test(name));
  if (!appIcon) throw new Error("The hashed ImgConvert app icon is missing from the Web build.");
  shellAssets.add(scopedUrl(`assets/${appIcon}`));
  shellAssets.add(scopedUrl("icons/icon-192.png"));
  shellAssets.add(scopedUrl("icons/icon-512.png"));
  shellAssets.add(scopedUrl("manifest.webmanifest"));
  const precacheUrls = [...shellAssets].sort();
  assertScopedUrls(precacheUrls);

  const allBuildUrls = assetNames.map((name) => scopedUrl(`assets/${name}`));
  assertScopedUrls(allBuildUrls);
  const manifest = `${JSON.stringify(
    {
      background_color: "#f8f5ed",
      categories: ["photo", "utilities"],
      description: "Private image conversion that stays on this device.",
      display: "standalone",
      icons: [
        { sizes: "192x192", src: scopedUrl("icons/icon-192.png"), type: "image/png" },
        { sizes: "512x512", src: scopedUrl("icons/icon-512.png"), type: "image/png" },
      ],
      id: PWA_SCOPE_PATH,
      name: "ImgConvert Web",
      prefer_related_applications: false,
      scope: PWA_SCOPE_PATH,
      short_name: "ImgConvert",
      start_url: PWA_SCOPE_PATH,
      theme_color: "#f8f5ed",
    },
    null,
    2,
  )}\n`;

  const buildId = createHash("sha256")
    .update(
      JSON.stringify({
        allBuildUrls,
        compatibility: PWA_COMPATIBILITY_VERSION,
        indexHtml,
        manifest,
        template,
      }),
    )
    .update(sourceIcon192)
    .update(sourceIcon512)
    .digest("hex")
    .slice(0, 16);

  const serviceWorker = template
    .replace("__IMGCONVERT_BUILD_ID__", buildId)
    .replace("__IMGCONVERT_CACHE_PREFIX__", PWA_CACHE_PREFIX)
    .replace("__IMGCONVERT_COMPATIBILITY_VERSION__", PWA_COMPATIBILITY_VERSION)
    .replace("__IMGCONVERT_PRECACHE_URLS__", JSON.stringify(precacheUrls))
    .replace("__IMGCONVERT_SCOPE_PATH__", PWA_SCOPE_PATH);
  if (/__IMGCONVERT_[A-Z_]+__/u.test(serviceWorker)) {
    throw new Error("The generated service worker still contains an unresolved placeholder.");
  }
  return { manifest, serviceWorker, sourceIcon192, sourceIcon512 };
}

const expected = await buildArtifacts();
if (globalThis.process.argv.includes("--check")) {
  const [icon192, icon512, manifest, serviceWorker] = await Promise.all([
    readFile(resolve(iconDirectory, "icon-192.png")),
    readFile(resolve(iconDirectory, "icon-512.png")),
    readFile(manifestPath, "utf8"),
    readFile(serviceWorkerPath, "utf8"),
  ]);
  if (
    !icon192.equals(expected.sourceIcon192) ||
    !icon512.equals(expected.sourceIcon512) ||
    manifest !== expected.manifest ||
    serviceWorker !== expected.serviceWorker
  ) {
    throw new Error("Generated PWA artifacts are stale. Run the Web app build again.");
  }
} else {
  await mkdir(iconDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(iconDirectory, "icon-192.png"), expected.sourceIcon192),
    writeFile(resolve(iconDirectory, "icon-512.png"), expected.sourceIcon512),
  ]);
  await Promise.all([
    writeFile(manifestPath, expected.manifest),
    writeFile(serviceWorkerPath, expected.serviceWorker),
  ]);
}
