// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browser = process.argv
  .find((argument) => argument.startsWith("--browser="))
  ?.slice("--browser=".length);

if (browser !== "chrome" && browser !== "edge") {
  throw new Error("Expected --browser=chrome or --browser=edge");
}

const buildRoot = join(projectRoot, ".output", `${browser}-mv3`);
const manifestPath = join(buildRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const extensionPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
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

async function localJavaScriptGraph(entryPath) {
  const discovered = new Set();
  const pending = [entryPath];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || discovered.has(path)) continue;
    discovered.add(path);
    const contents = await readFile(path, "utf8");
    const specifiers = [
      ...[...contents.matchAll(/\bfrom\s*["'`]([^"'`]+)["'`]/gu)].map((match) => match[1]),
      ...[...contents.matchAll(/\bimport\s*(?:\(\s*)?["'`]([^"'`]+)["'`]/gu)].map(
        (match) => match[1],
      ),
    ];
    for (const specifier of specifiers) {
      if (!specifier?.startsWith(".")) continue;
      const dependency = resolve(dirname(path), specifier);
      if (dependency !== buildRoot && !dependency.startsWith(`${buildRoot}${sep}`)) {
        failures.push(`background import escapes the extension build: ${specifier}`);
        continue;
      }
      if ([".js", ".mjs"].includes(extname(dependency))) pending.push(dependency);
    }
  }
  return [...discovered].sort((left, right) => left.localeCompare(right, "en"));
}

function pngDimensions(bytes) {
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== pngSignature) return undefined;
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

check(manifest.manifest_version === 3, "manifest_version must be 3");
check(
  manifest.version === extensionPackage.version,
  "manifest version must match extension package",
);
check(manifest.minimum_chrome_version === "116", "minimum_chrome_version must be 116");
check(
  manifest.homepage_url === "https://imgconvert.web.casa/",
  "homepage_url must use the canonical ImgConvert HTTPS website",
);
check(
  sameStrings(manifest.permissions, ["contextMenus", "sidePanel", "storage"]),
  "permissions must contain only contextMenus, sidePanel, and storage",
);
check(
  sameStrings(manifest.optional_host_permissions, ["https://*/*"]),
  "optional_host_permissions must contain only the runtime-requested HTTPS scheme",
);
check(manifest.action !== undefined, "action must be declared");
check(manifest.action?.default_popup === undefined, "action must not define a popup");
check(
  manifest.side_panel?.default_path === "converter.html?surface=side-panel",
  "side_panel must use the packaged compact converter surface",
);
check(manifest.background?.type === "module", "background must be an ES module service worker");
check(
  typeof manifest.background?.service_worker === "string",
  "background.service_worker must be generated",
);

for (const forbiddenKey of [
  "commands",
  "content_scripts",
  "externally_connectable",
  "host_permissions",
  "key",
  "optional_permissions",
  "update_url",
  "web_accessible_resources",
]) {
  check(manifest[forbiddenKey] === undefined, `manifest must not contain ${forbiddenKey}`);
}

const csp = manifest.content_security_policy?.extension_pages;
check(
  csp === "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  "extension page CSP must allow only packaged scripts, packaged WASM, and self-hosted objects",
);
check(!csp?.includes("'unsafe-eval'"), "extension page CSP must not allow unsafe-eval");
check(!csp?.includes("http:"), "extension page CSP must not allow remote HTTP sources");
check(!csp?.includes("https:"), "extension page CSP must not allow remote HTTPS sources");

check(manifest.default_locale === "en", "default locale must be en");
check(manifest.name === "__MSG_extensionName__", "name must use localized manifest copy");
check(
  manifest.description === "__MSG_extensionDescription__",
  "description must use localized manifest copy",
);

const iconSizes = [16, 32, 48, 128];
for (const size of iconSizes) {
  const iconPath = manifest.icons?.[String(size)];
  const actionIconPath = manifest.action?.default_icon?.[String(size)];
  check(iconPath === `icon/${size}.png`, `manifest icon ${size} must use icon/${size}.png`);
  check(actionIconPath === iconPath, `action icon ${size} must match the manifest icon`);
  if (typeof iconPath === "string") {
    try {
      const dimensions = pngDimensions(await readFile(join(buildRoot, iconPath)));
      check(
        dimensions?.width === size && dimensions.height === size,
        `icon ${size} must be an exact ${size}×${size} PNG`,
      );
    } catch {
      failures.push(`icon ${size} is missing from the build`);
    }
  }
}

try {
  await stat(join(buildRoot, "converter.html"));
} catch {
  failures.push("converter.html is missing from the build");
}

const allFiles = await filesUnder(buildRoot);
const fileReports = await Promise.all(
  allFiles
    .map((path) => ({ path, relativePath: relative(buildRoot, path).split(sep).join("/") }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"))
    .map(async ({ path, relativePath }) => {
      const contents = await readFile(path);
      return Object.freeze({
        bytes: contents.byteLength,
        path: relativePath,
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
    }),
);
const sourceMaps = allFiles.filter((path) => extname(path) === ".map");
check(sourceMaps.length === 0, "production build must not contain source maps");

const scannableExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);
for (const path of allFiles.filter((file) => scannableExtensions.has(extname(file)))) {
  const contents = await readFile(path, "utf8");
  const displayPath = relative(buildRoot, path);
  check(
    !contents.includes("__imgconvert_runtime_check") && !contents.includes("runtime-diagnostics"),
    `${displayPath} contains the test-only runtime diagnostics hook`,
  );
  check(!/\beval\s*\(/.test(contents), `${displayPath} contains eval()`);
  check(!/\bnew\s+Function\s*\(/.test(contents), `${displayPath} contains new Function()`);
  check(
    !/\b(?:fetch|importScripts)\s*\(\s*["'`]https?:\/\//i.test(contents),
    `${displayPath} contains a literal remote network call`,
  );
  check(
    !/\bimport\s*\(\s*["'`]https?:\/\//i.test(contents),
    `${displayPath} contains a literal remote dynamic import`,
  );
  check(
    !/\bnew\s+(?:SharedWorker|Worker)\s*\(\s*["'`]https?:\/\//i.test(contents),
    `${displayPath} contains a literal remote worker`,
  );
  if (extname(path) === ".html") {
    check(!/\son[a-z]+\s*=/i.test(contents), `${displayPath} contains an inline event handler`);
    check(
      !/\b(?:href|src)\s*=\s*["']https?:\/\//i.test(contents),
      `${displayPath} contains a remote HTML asset`,
    );
  }
  if (extname(path) === ".css") {
    check(
      !/url\(\s*["']?https?:\/\//i.test(contents),
      `${displayPath} contains a remote CSS asset`,
    );
  }
}

const assetReferences = new Set();
for (const path of allFiles.filter((file) => [".html", ".js", ".mjs"].includes(extname(file)))) {
  const contents = await readFile(path, "utf8");
  for (const match of contents.matchAll(/["'`](\/(?:assets|chunks)\/[^"'`?#]+)["'`]/gu)) {
    if (match[1]) assetReferences.add(match[1].slice(1));
  }
}
for (const reference of assetReferences) {
  try {
    await stat(join(buildRoot, reference));
  } catch {
    failures.push(`packaged asset reference is missing: ${reference}`);
  }
}

const workerAssets = allFiles.filter((path) => /(?:codec|archive)\.worker-[^/]+\.js$/u.test(path));
check(workerAssets.length === 4, "build must contain exactly four shared-runtime Worker assets");
const wasmAssets = allFiles.filter((path) => extname(path) === ".wasm");
check(wasmAssets.length >= 8, "build must contain the packaged raster and SVG WASM assets");
check(
  !String(await readFile(join(buildRoot, "converter.html"), "utf8")).includes("diagnostics-"),
  "runtime diagnostics must remain lazy on ordinary converter-shell startup",
);

const backgroundPath = manifest.background?.service_worker;
const backgroundAssetPaths =
  typeof backgroundPath === "string"
    ? await localJavaScriptGraph(join(buildRoot, backgroundPath))
    : [];
const backgroundBytes = (
  await Promise.all(backgroundAssetPaths.map(async (path) => (await stat(path)).size))
).reduce((total, bytes) => total + bytes, 0);
if (typeof backgroundPath === "string") {
  const resolvedBackgroundPath = join(buildRoot, backgroundPath);
  const backgroundContents = await readFile(resolvedBackgroundPath, "utf8");
  const backgroundGraphContents = (
    await Promise.all(backgroundAssetPaths.map((path) => readFile(path, "utf8")))
  ).join("\n");
  check(backgroundBytes <= 100 * 1024, "background JS graph exceeds the 100 KiB EXT budget");
  check(
    backgroundGraphContents.includes("imgconvert.preferences"),
    "background graph must retain the packaged preference migration",
  );
  check(
    !backgroundContents.includes("__vite__mapDeps"),
    "background must not use Vite's DOM-dependent dynamic-import preload helper",
  );
  for (const backgroundAssetPath of backgroundAssetPaths) {
    const displayPath = relative(buildRoot, backgroundAssetPath).split(sep).join("/");
    check(
      !/(?:codec|archive)\.worker-|chunks\/(?:converter|diagnostics)-|\.wasm$/u.test(displayPath),
      `background graph must not reach conversion asset ${displayPath}`,
    );
  }
  for (const requiredApi of [
    ".contextMenus.onClicked.addListener",
    ".runtime.onInstalled.addListener",
    ".runtime.onMessage.addListener",
    ".sidePanel.open",
    ".sidePanel.setPanelBehavior",
    ".storage.local.setAccessLevel",
    ".storage.session",
  ]) {
    check(backgroundContents.includes(requiredApi), `background must use ${requiredApi}`);
  }
  for (const requiredContextMenuToken of [
    "imgconvert.convertWebImage",
    "https://*/*",
    ".removeAll(",
    ".create(",
  ]) {
    check(
      backgroundContents.includes(requiredContextMenuToken),
      `background must retain context-menu token ${requiredContextMenuToken}`,
    );
  }
  for (const forbiddenApi of [
    ".action.onClicked.addListener",
    ".alarms.",
    ".offscreen.",
    ".scripting.",
    ".tabs.query(",
  ]) {
    check(!backgroundContents.includes(forbiddenApi), `background must not use ${forbiddenApi}`);
  }
  for (const forbiddenRuntime of [
    "pdfjs",
    "resvg",
    "raster-codec",
    "svg-codec",
    "archive.worker",
  ]) {
    check(
      !backgroundContents.toLowerCase().includes(forbiddenRuntime),
      `background must not bundle conversion runtime token ${forbiddenRuntime}`,
    );
  }
}

const converterHtml = await readFile(join(buildRoot, "converter.html"), "utf8");
const initialAssetPaths = new Set(
  [...converterHtml.matchAll(/(?:href|src)=["']\/([^"'?#]+)["']/gu)]
    .map((match) => match[1])
    .filter((path) => path && [".css", ".js", ".mjs"].includes(extname(path))),
);
const converterInitialBytes = (
  await Promise.all(
    [...initialAssetPaths].map(async (path) => (await stat(join(buildRoot, path))).size),
  )
).reduce((total, bytes) => total + bytes, 0);
check(
  converterInitialBytes <= 500 * 1024,
  "converter initial JS and CSS exceed the 500 KiB EXT budget",
);

const totalBytes = fileReports.reduce((total, file) => total + file.bytes, 0);
check(totalBytes <= 16 * 1024 * 1024, "unpacked extension exceeds the 16 MiB EXT budget");

const report = Object.freeze({
  browser,
  budgets: {
    background: {
      actualBytes: backgroundBytes,
      limitBytes: 100 * 1024,
      passed: backgroundBytes <= 100 * 1024,
      remainingBytes: 100 * 1024 - backgroundBytes,
    },
    converterInitial: {
      actualBytes: converterInitialBytes,
      limitBytes: 500 * 1024,
      passed: converterInitialBytes <= 500 * 1024,
      remainingBytes: 500 * 1024 - converterInitialBytes,
    },
    unpacked: {
      actualBytes: totalBytes,
      limitBytes: 16 * 1024 * 1024,
      passed: totalBytes <= 16 * 1024 * 1024,
      remainingBytes: 16 * 1024 * 1024 - totalBytes,
    },
  },
  counts: {
    files: fileReports.length,
    wasm: wasmAssets.length,
    workers: workerAssets.length,
  },
  entrypoints: {
    background: backgroundAssetPaths.map((path) => relative(buildRoot, path).split(sep).join("/")),
    converterInitial: [...initialAssetPaths].sort(),
  },
  failures,
  files: fileReports,
  manifest: {
    manifestVersion: manifest.manifest_version,
    minimumChromeVersion: manifest.minimum_chrome_version,
    optionalHostPermissions: manifest.optional_host_permissions,
    permissions: manifest.permissions,
    version: manifest.version,
  },
  passed: failures.length === 0,
  schemaVersion: 1,
});
const reportDirectory = join(projectRoot, ".output", "reports");
const reportPath = join(reportDirectory, `${browser}-bundle.json`);
await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (failures.length > 0) {
  throw new Error(
    `${browser} extension guardrails failed (report: ${relative(projectRoot, reportPath)}):\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  `${browser}: manifest, CSP, permissions, icons, remote-code scan, and size budgets passed (${allFiles.length} files, ${totalBytes} bytes; report: ${relative(projectRoot, reportPath)})`,
);
