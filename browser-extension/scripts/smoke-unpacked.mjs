// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { smokeEnvironment } from "./environment-smoke.mjs";
import { smokeNativeSidePanels } from "./native-side-panel-smoke.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

function argumentValue(name) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

const browser = process.argv
  .find((argument) => argument.startsWith("--browser="))
  ?.slice("--browser=".length);
const runEnvironment = process.argv.includes("--environment");
let environmentMetrics;
const runRuntime = process.argv.includes("--runtime");
const runNativeSidePanel = process.argv.includes("--native-side-panel");
const runOffline = process.argv.includes("--offline");
const runAccessibility = process.argv.includes("--accessibility");
const runResource = process.argv.includes("--resource");
const expectWebImportDenied = process.argv.includes("--deny-web-import");
const runWebImport = process.argv.includes("--web-import") || expectWebImportDenied;
const expectedProduct = argumentValue("--expected-product") ?? "any";
const expectedMajorArgument = argumentValue("--expected-major");
const expectedMajor =
  expectedMajorArgument === undefined ? undefined : Number.parseInt(expectedMajorArgument, 10);
const reportArgument = argumentValue("--report");
const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAhElEQVR4nBXKIRVEIRRF0YnzAxCAAARgoRFIFApxBQlI8PQpeWex9f59DaWGckOlodpwb3g2vBv+fQOlgfJAZaA6cB94DrzHCwulhfJCZaG6cF94LrzXCwelg/JB5aB6cD94HrzPCxeli/JF5aJ6cb94XrzvC4FSoByoBKqBe+AZeAf+A42rapk80shGAAAAAElFTkSuQmCC",
  "base64",
);
// `.dev` is HSTS-preloaded in vendor Chrome, while reserved testing suffixes
// are intentionally rejected by the product's public-host validator. This
// harness-only public-shaped hostname is isolated by the browser resolver rule.
const webFixtureHost = "fixture.imgconvert-web-smoke.net";

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}

async function closeServer(server) {
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function bmpFixture(width = 32, height = 24) {
  const stride = Math.ceil((width * 24) / 32) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(stride * height, 34);
  for (let offset = 54; offset < bytes.length; offset += 3) {
    bytes[offset] = 170;
    bytes[offset + 1] = 100;
    bytes[offset + 2] = 45;
  }
  return bytes;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([length, typeBytes, payload, checksum]);
}

function solidPngFixture(width, height) {
  const rowBytes = width * 4 + 1;
  const raster = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowBytes;
    raster[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      raster[pixel] = 50;
      raster[pixel + 1] = 106;
      raster[pixel + 2] = 57;
      raster[pixel + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raster, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function browserProduct(versionText) {
  const normalized = versionText.toLowerCase();
  if (normalized.includes("microsoft edge")) return "edge";
  if (normalized.includes("google chrome")) return "chrome";
  if (normalized.includes("chromium")) return "chromium";
  return "unknown";
}

function runtimeBrowserProduct(runtime) {
  const brands = runtime.brands.map(({ brand }) => brand.toLowerCase());
  const userAgent = runtime.userAgent.toLowerCase();
  if (brands.some((brand) => brand.includes("microsoft edge")) || userAgent.includes("edg/")) {
    return "edge";
  }
  if (brands.some((brand) => brand.includes("google chrome"))) return "chrome";
  if (brands.some((brand) => brand === "chromium")) return "chromium";
  return browserProduct(userAgent);
}

function browserMajor(versionText) {
  const match = /\b(\d{2,3})\.\d+\.\d+\.\d+\b/u.exec(versionText);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function colorChannels(value) {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value.trim());
  if (hex) return hex.slice(1).map((channel) => Number.parseInt(channel, 16));
  const rgb = /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/iu.exec(value.trim());
  if (rgb) return rgb.slice(1).map(Number);
  throw new Error(`Unsupported computed color: ${value}`);
}

function relativeLuminance(value) {
  const channels = colorChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

async function executableIdentity(executable) {
  const { stderr, stdout } = await execFileAsync(executable, ["--version"]);
  const version = `${stdout}${stderr}`.trim();
  return Object.freeze({ major: browserMajor(version), product: browserProduct(version), version });
}

async function downloadBytes(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Browser did not expose the downloaded result stream");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function buildFingerprint(target) {
  const report = JSON.parse(
    await readFile(join(projectRoot, ".output", "reports", `${target}-bundle.json`), "utf8"),
  );
  if (!report.passed || !Array.isArray(report.files)) {
    throw new Error(`Missing passing ${target} bundle report; run guardrails first`);
  }
  const digest = createHash("sha256");
  for (const file of report.files) digest.update(`${file.path}\0${file.sha256}\n`);
  return Object.freeze({ files: report.counts.files, sha256: digest.digest("hex") });
}

async function processTreeMemory(profile) {
  if (process.platform !== "linux") return undefined;
  const processes = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    try {
      const [commandLine, status] = await Promise.all([
        readFile(`/proc/${entry.name}/cmdline`, "utf8"),
        readFile(`/proc/${entry.name}/status`, "utf8"),
      ]);
      const parent = Number.parseInt(/^PPid:\s+(\d+)$/mu.exec(status)?.[1] ?? "-1", 10);
      const rssKiB = Number.parseInt(/^VmRSS:\s+(\d+)\s+kB$/mu.exec(status)?.[1] ?? "0", 10);
      processes.push({ commandLine, parent, pid: Number.parseInt(entry.name, 10), rssKiB });
    } catch {
      // A process can exit between /proc enumeration and reading; omit that sample.
    }
  }
  const roots = processes
    .filter(({ commandLine }) => commandLine.includes(`--user-data-dir=${profile}`))
    .map(({ pid }) => pid);
  if (roots.length === 0) return undefined;
  const included = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (!included.has(processInfo.pid) && included.has(processInfo.parent)) {
        included.add(processInfo.pid);
        changed = true;
      }
    }
  }
  const selected = processes.filter(({ pid }) => included.has(pid));
  return Object.freeze({
    processCount: selected.length,
    rssBytes: selected.reduce((total, processInfo) => total + processInfo.rssKiB * 1024, 0),
  });
}

async function accessibilityAudit(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const incompleteDetails = result.incomplete.map((incomplete) => ({
    help: incomplete.help,
    id: incomplete.id,
    impact: incomplete.impact,
    targets: incomplete.nodes.flatMap((node) => node.target.map(String)).slice(0, 8),
  }));
  const unverifiedIncomplete = incompleteDetails.filter(({ id }) => id !== "color-contrast");
  if (unverifiedIncomplete.length > 0) {
    throw new Error(`Unresolved accessibility checks: ${JSON.stringify(unverifiedIncomplete)}`);
  }
  const tokenColors = await page.locator(".extension-shell").evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    const token = (name) => style.getPropertyValue(name).trim();
    return {
      green: token("--green"),
      greenDeep: token("--green-deep"),
      greenSoft: token("--green-soft"),
      ink: token("--ink"),
      inkSoft: token("--ink-soft"),
      paper: token("--paper"),
      paperRaised: token("--paper-raised"),
      paperSoft: token("--paper-soft"),
      red: token("--red"),
      theme: element.getAttribute("data-theme"),
      yellowSoft: token("--yellow-soft"),
    };
  });
  const contrastPairs = [
    ["primary text", tokenColors.ink, tokenColors.paper],
    ["muted text", tokenColors.inkSoft, tokenColors.paper],
    ["raised muted text", tokenColors.inkSoft, tokenColors.paperRaised],
    ["green text", tokenColors.greenDeep, tokenColors.paper],
    ["green badge", tokenColors.greenDeep, tokenColors.greenSoft],
    ["error text", tokenColors.red, tokenColors.paperSoft],
    ["dark button", tokenColors.paperRaised, tokenColors.ink],
    ["green button", "#102315", tokenColors.green],
    ["notice text", tokenColors.ink, tokenColors.yellowSoft],
  ].map(([name, foreground, background]) => ({
    background,
    foreground,
    name,
    ratio: contrastRatio(foreground, background),
  }));
  const failedContrast = contrastPairs.filter(({ ratio }) => ratio < 4.5);
  if (failedContrast.length > 0) {
    throw new Error(`Token contrast is below 4.5:1: ${JSON.stringify(failedContrast)}`);
  }
  return Object.freeze({
    incomplete: result.incomplete.length,
    incompleteDetails,
    passes: result.passes.length,
    tokenContrast: Object.freeze({ pairs: contrastPairs, passed: true, theme: tokenColors.theme }),
    violations: result.violations.map((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target.map(String)).slice(0, 8),
    })),
  });
}

function requireNoAccessibilityViolations(label, result) {
  if (result.violations.length > 0) {
    throw new Error(`${label} accessibility violations: ${JSON.stringify(result.violations)}`);
  }
}

async function keyboardAccessibilityAudit(page) {
  await page.evaluate(() => {
    if (globalThis.document.activeElement instanceof globalThis.HTMLElement) {
      globalThis.document.activeElement.blur();
    }
  });
  await page.keyboard.press("Tab");
  const firstFocus = await page.evaluate(() => ({
    bottom:
      globalThis.document.activeElement instanceof globalThis.HTMLElement
        ? globalThis.document.activeElement.getBoundingClientRect().bottom
        : -1,
    className:
      globalThis.document.activeElement instanceof globalThis.HTMLElement
        ? globalThis.document.activeElement.className
        : "",
    href:
      globalThis.document.activeElement instanceof globalThis.HTMLAnchorElement
        ? globalThis.document.activeElement.getAttribute("href")
        : null,
  }));
  if (
    firstFocus.href !== "#workspace" ||
    !String(firstFocus.className).includes("skip-link") ||
    firstFocus.bottom <= 0
  ) {
    throw new Error(
      `First keyboard focus is not the workspace skip link: ${JSON.stringify(firstFocus)}`,
    );
  }
  await page.keyboard.press("Enter");
  const skipTarget = await page.evaluate(() => globalThis.document.activeElement?.id ?? "");
  if (skipTarget !== "workspace")
    throw new Error("Skip link did not focus the workbench main region");

  const themeButton = page.locator('[data-testid="theme-button"]');
  await page.keyboard.press("Shift+Tab");
  const previousControl = await page.evaluate(() =>
    globalThis.document.activeElement instanceof globalThis.HTMLAnchorElement
      ? globalThis.document.activeElement.getAttribute("href")
      : null,
  );
  if (previousControl !== "#convert-panel") {
    throw new Error("Reverse keyboard navigation did not reach the final workbench step");
  }
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  if (!(await themeButton.evaluate((element) => element === globalThis.document.activeElement))) {
    throw new Error(
      "Reverse keyboard navigation from the workspace did not reach the theme control",
    );
  }
  const focusStyle = await themeButton.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      active: element === globalThis.document.activeElement,
      focus: element.matches(":focus"),
      focusVisible: element.matches(":focus-visible"),
      green: style.getPropertyValue("--green"),
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  if (focusStyle.outlineStyle === "none" || Number.parseFloat(focusStyle.outlineWidth) < 2) {
    throw new Error(`Theme control has no visible keyboard focus: ${JSON.stringify(focusStyle)}`);
  }

  const resetButton = page.locator('[data-testid="reset-preferences"]');
  await resetButton.focus();
  await page.keyboard.press("Enter");
  await page.locator("dialog.confirm-dialog[open]").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("dialog.confirm-dialog[open]").waitFor({ state: "hidden" });
  if (!(await resetButton.evaluate((element) => element === globalThis.document.activeElement))) {
    throw new Error("Closing the reset dialog did not restore focus to its trigger");
  }
  return Object.freeze({ firstFocus: "skip-link", focusRestored: true, visibleFocus: true });
}

if (browser !== "chrome" && browser !== "edge") {
  throw new Error("Expected --browser=chrome or --browser=edge");
}
if (!["any", "chrome", "chromium", "edge"].includes(expectedProduct)) {
  throw new Error("Expected --expected-product=chrome, chromium, edge, or any");
}
if (
  expectedMajorArgument !== undefined &&
  (!Number.isSafeInteger(expectedMajor) || expectedMajor < 88)
) {
  throw new Error("Expected --expected-major to be an integer of at least 88");
}
if (runOffline && runWebImport) {
  throw new Error("Offline smoke cannot be combined with the network-backed web-import smoke");
}

const configuredExecutable =
  browser === "edge"
    ? process.env.IMGCONVERT_EDGE_EXECUTABLE
    : (process.env.IMGCONVERT_CHROME_EXECUTABLE ?? process.env.IMGCONVERT_CHROMIUM_EXECUTABLE);
const fallbackExecutable = browser === "chrome" ? "/usr/bin/chromium" : undefined;
const executablePath = configuredExecutable ?? fallbackExecutable;
const cdpEndpoint = process.env.IMGCONVERT_CDP_ENDPOINT;

if (executablePath === undefined && cdpEndpoint === undefined) {
  throw new Error(
    browser === "edge"
      ? "Set IMGCONVERT_EDGE_EXECUTABLE to a Chromium Edge binary"
      : "Set IMGCONVERT_CHROMIUM_EXECUTABLE to a Chrome or Chromium binary",
  );
}

let identity = Object.freeze({ major: undefined, product: "unknown", version: "remote CDP" });
if (!cdpEndpoint) {
  await access(executablePath);
  identity = await executableIdentity(executablePath);
  if (expectedProduct !== "any" && identity.product !== expectedProduct) {
    throw new Error(
      `Expected ${expectedProduct} executable, got ${identity.product}: ${identity.version}`,
    );
  }
  if (expectedMajor !== undefined && identity.major !== expectedMajor) {
    throw new Error(`Expected browser major ${expectedMajor}, got ${identity.version}`);
  }
}
const extensionPath = join(
  projectRoot,
  ".output",
  `${browser}-mv3${runRuntime ? "-diagnostics" : ""}`,
);
const extensionManifest = JSON.parse(await readFile(join(extensionPath, "manifest.json"), "utf8"));
const fingerprint = await buildFingerprint(browser);

const reportsRoot = resolve(projectRoot, ".output", "reports");
const reportPath = reportArgument ? resolve(projectRoot, reportArgument) : undefined;
if (reportPath && reportPath !== reportsRoot && !reportPath.startsWith(`${reportsRoot}/`)) {
  throw new Error("Smoke reports must be written below browser-extension/.output/reports");
}

const profilePath = await mkdtemp(join(tmpdir(), `imgconvert-${browser}-smoke-`));
const browserErrors = [];
const webFixtureRequests = [];
let webFixtureServer;
let webFixtureTlsPath;
let webFixtureOrigin;
let webFixtureUrl;
if (runWebImport) {
  webFixtureTlsPath = await mkdtemp(join(tmpdir(), "imgconvert-web-import-tls-"));
  const keyPath = join(webFixtureTlsPath, "key.pem");
  const certificatePath = join(webFixtureTlsPath, "certificate.pem");
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    `/CN=${webFixtureHost}`,
    "-addext",
    `subjectAltName=DNS:${webFixtureHost}`,
  ]);
  webFixtureServer = createSecureServer(
    {
      cert: await readFile(certificatePath),
      key: await readFile(keyPath),
    },
    (request, response) => {
      webFixtureRequests.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        method: request.method,
        referer: request.headers.referer,
        url: request.url,
      });
      if (request.url !== "/web-smoke.png") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": String(pngFixture.byteLength),
        "content-type": "image/png",
      });
      response.end(pngFixture);
    },
  );
  await listen(webFixtureServer);
  const webFixtureAddress = webFixtureServer.address();
  if (!webFixtureAddress || typeof webFixtureAddress === "string") {
    throw new Error("Web-import fixture server did not expose a TCP port");
  }
  webFixtureOrigin = `https://${webFixtureHost}:${webFixtureAddress.port}`;
  webFixtureUrl = `${webFixtureOrigin}/web-smoke.png`;
}
let context;
let smokeError;
const resourceMetrics = {};
let sidePanelMetrics;
let nativeSidePanelMetrics;
const accessibilityMetrics = {};
const browserInternalMessages = [];
const webImportMetrics = runWebImport
  ? {
      blockedDescriptorConsumed: false,
      decision: expectWebImportDenied ? "deny" : "allow",
      descriptorConsumed: false,
      permissionRetained: undefined,
      queueAdmitted: false,
    }
  : undefined;
let runtimeIdentity;
let connectedBrowser;

try {
  if (cdpEndpoint) {
    connectedBrowser = await chromium.connectOverCDP(cdpEndpoint);
    context = connectedBrowser.contexts()[0];
    if (!context) throw new Error("Remote CDP browser did not expose its default context");
  } else {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...(runWebImport
          ? [
              `--host-resolver-rules=MAP ${webFixtureHost} 127.0.0.1`,
              "--ignore-certificate-errors",
              "--no-proxy-server",
            ]
          : []),
        "--no-first-run",
        "--no-default-browser-check",
      ],
      executablePath,
      headless: false,
    });
  }
  if (runOffline) await context.setOffline(true);

  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        const location = message.location();
        const diagnostic = `console at ${location.url || page.url()}:${location.lineNumber}:${location.columnNumber}: ${message.text()}`;
        if (/^(?:chrome|edge):/u.test(location.url)) browserInternalMessages.push(diagnostic);
        else browserErrors.push(diagnostic);
      }
    });
    page.on("pageerror", (error) =>
      browserErrors.push(`pageerror at ${page.url()}: ${error.message}`),
    );
  });

  let observedWorkers = [];
  let extensionWorkers = [];
  const workerDeadline = Date.now() + 15_000;
  while (Date.now() < workerDeadline && extensionWorkers.length !== 1) {
    observedWorkers = await Promise.all(
      context.serviceWorkers().map(async (worker) => {
        let manifest;
        try {
          manifest = await worker.evaluate(() => globalThis.chrome?.runtime?.getManifest?.());
        } catch {
          // A worker may stop while its identity is being inspected; retry the live registrations.
        }
        return { manifest, url: worker.url(), worker };
      }),
    );
    extensionWorkers = observedWorkers.filter(
      ({ manifest, url }) =>
        new URL(url).pathname === `/${extensionManifest.background.service_worker}` &&
        manifest?.version === extensionManifest.version &&
        manifest?.default_locale === extensionManifest.default_locale,
    );
    if (extensionWorkers.length !== 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  if (extensionWorkers.length !== 1) {
    throw new Error(
      `Expected one ImgConvert ${extensionManifest.version} service worker, found ${extensionWorkers.length}; observed: ${observedWorkers.map(({ manifest, url }) => `${url} (${manifest?.name ?? "unidentified"} ${manifest?.version ?? "unknown"})`).join(", ")}`,
    );
  }

  const serviceWorkerUrl = new URL(extensionWorkers[0].url);
  const extensionOrigin = `${serviceWorkerUrl.protocol}//${serviceWorkerUrl.host}`;
  const sidePanelConfiguration = await extensionWorkers[0].worker.evaluate(async () => ({
    behavior: await chrome.sidePanel.getPanelBehavior(),
    options: await chrome.sidePanel.getOptions({}),
  }));
  if (sidePanelConfiguration.behavior.openPanelOnActionClick !== true) {
    throw new Error("The extension action is not configured to toggle the side panel");
  }
  if (sidePanelConfiguration.options.path !== "converter.html?surface=side-panel") {
    throw new Error(`Unexpected live side panel path: ${sidePanelConfiguration.options.path}`);
  }

  const sidePanelPage = await context.newPage();
  const sidePanelNetworkRequests = [];
  sidePanelPage.on("request", (request) => {
    if (/^https?:/iu.test(request.url())) sidePanelNetworkRequests.push(request.url());
  });
  await sidePanelPage.setViewportSize({ width: 400, height: 900 });
  await sidePanelPage.goto(`${extensionOrigin}/converter.html?surface=side-panel`, {
    waitUntil: "domcontentloaded",
  });
  await sidePanelPage.locator("#workspace").waitFor({ state: "visible" });
  const sidePanelLayout = await sidePanelPage.evaluate(() => ({
    clientWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    surface: globalThis.document.querySelector(".extension-shell")?.getAttribute("data-surface"),
  }));
  if (
    sidePanelLayout.surface !== "side-panel" ||
    sidePanelLayout.scrollWidth > sidePanelLayout.clientWidth
  ) {
    throw new Error(`Side panel layout overflowed: ${JSON.stringify(sidePanelLayout)}`);
  }
  const sidePanelWidths = [];
  for (const width of [320, 400, 480]) {
    await sidePanelPage.setViewportSize({ width, height: 900 });
    const measurement = await sidePanelPage.evaluate(() => ({
      clientWidth: globalThis.document.documentElement.clientWidth,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
    }));
    sidePanelWidths.push({ ...measurement, width });
    if (measurement.scrollWidth > measurement.clientWidth) {
      throw new Error(`Side panel width overflowed: ${JSON.stringify(sidePanelWidths)}`);
    }
  }
  await sidePanelPage.setViewportSize({ width: 400, height: 900 });
  const externalLinks = await sidePanelPage
    .locator("[data-external-link]")
    .evaluateAll((links) => ({
      language: globalThis.document.documentElement.lang,
      links: links.map((link) => ({
        href: link.href,
        referrerPolicy: link.referrerPolicy,
        rel: [...link.relList].sort(),
        target: link.target,
        testId: link.getAttribute("data-testid"),
      })),
    }));
  const localizedPrefix = externalLinks.language === "zh-CN" ? "" : "en/";
  const expectedExternalLinks = new Map([
    ["external-link-brand", "https://imgconvert.web.casa/"],
    ["external-link-footer-brand", "https://imgconvert.web.casa/"],
    ["external-link-website", "https://imgconvert.web.casa/"],
    ["external-link-docs", `https://imgconvert.web.casa/${localizedPrefix}docs/`],
    ["external-link-privacy", `https://imgconvert.web.casa/${localizedPrefix}privacy/`],
    ["external-link-desktop-download", "https://imgconvert.web.casa/#download"],
    ["external-link-github", "https://github.com/web-casa/ImgConvert"],
  ]);
  if (externalLinks.links.length !== expectedExternalLinks.size) {
    throw new Error(`Unexpected external link count: ${JSON.stringify(externalLinks)}`);
  }
  for (const link of externalLinks.links) {
    const expectedHref = expectedExternalLinks.get(link.testId);
    if (
      link.href !== expectedHref ||
      link.target !== "_blank" ||
      link.referrerPolicy !== "no-referrer" ||
      link.rel.join(" ") !== "noopener noreferrer"
    ) {
      throw new Error(`Unsafe or unexpected external link: ${JSON.stringify(link)}`);
    }
    expectedExternalLinks.delete(link.testId);
  }
  if (expectedExternalLinks.size > 0) {
    throw new Error(`Missing external links: ${[...expectedExternalLinks.keys()].join(", ")}`);
  }
  const fullWorkspaceLink = sidePanelPage.locator('[data-testid="open-full-workspace"]');
  await fullWorkspaceLink.waitFor({ state: "visible" });
  const popupPromise = sidePanelPage.waitForEvent("popup");
  await fullWorkspaceLink.click();
  const fullWorkspacePage = await popupPromise;
  await fullWorkspacePage.waitForLoadState("domcontentloaded");
  if (new URL(fullWorkspacePage.url()).searchParams.get("surface") !== "full") {
    throw new Error(`Full-workspace link opened an unexpected URL: ${fullWorkspacePage.url()}`);
  }
  await fullWorkspacePage.locator("#workspace").waitFor({ state: "visible" });
  await fullWorkspacePage.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    if (!Number.isSafeInteger(tab?.windowId)) throw new Error("Missing converter window ID");
    await chrome.storage.session.set({
      [`imgconvert.pendingImport.${tab.windowId}`]: {
        code: "unsupported-scheme",
        createdAt: Date.now(),
        kind: "blocked",
        nonce: crypto.randomUUID(),
        schemaVersion: 1,
        sourceLabel: "data",
      },
    });
  });
  await sidePanelPage
    .locator('[data-testid="web-import-status"][data-state="ready"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  await fullWorkspacePage.waitForTimeout(250);
  if ((await fullWorkspacePage.locator('[data-testid="web-import-status"]').count()) !== 0) {
    throw new Error("The full workspace stole a side-panel web-image handoff");
  }
  const isolatedHandoffSession = await sidePanelPage.evaluate(async () =>
    chrome.storage.session.get(null),
  );
  if (JSON.stringify(isolatedHandoffSession).includes("pendingImport")) {
    throw new Error("The side-panel handoff was not consumed exactly once");
  }
  await sidePanelPage.locator('[data-testid="web-import-dismiss"]').click();
  const leaseSmokeUrl = "https://cdn.example.net/lease-smoke.png";
  await sidePanelPage.evaluate(async (sourceUrl) => {
    const tab = await chrome.tabs.getCurrent();
    if (!Number.isSafeInteger(tab?.windowId)) throw new Error("Missing converter window ID");
    const parsed = new URL(sourceUrl);
    await chrome.storage.session.set({
      [`imgconvert.pendingImport.${tab.windowId}`]: {
        createdAt: Date.now(),
        displayName: "lease-smoke.png",
        kind: "remote",
        nonce: crypto.randomUUID(),
        permissionPattern: `${parsed.protocol}//${parsed.host}/*`,
        schemaVersion: 1,
        sourceOrigin: parsed.origin,
        sourceUrl,
      },
    });
  }, leaseSmokeUrl);
  await sidePanelPage
    .locator('[data-testid="web-import-status"][data-state="ready"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  const activeLeaseStorage = await sidePanelPage.evaluate(async () =>
    chrome.storage.local.get(null),
  );
  const activeLeaseText = JSON.stringify(activeLeaseStorage);
  if (
    !activeLeaseText.includes("imgconvert.permissionLease.") ||
    activeLeaseText.includes(leaseSmokeUrl)
  ) {
    throw new Error(`Temporary permission lease was missing or retained a URL: ${activeLeaseText}`);
  }
  await sidePanelPage.locator('[data-testid="web-import-dismiss"]').click();
  await sidePanelPage.waitForFunction(async () => {
    const stored = await chrome.storage.local.get(null);
    return !Object.keys(stored).some((key) => key.startsWith("imgconvert.permissionLease."));
  });
  const leasePermissionRetained = await sidePanelPage.evaluate(async () =>
    chrome.permissions.contains({ origins: ["https://cdn.example.net/*"] }),
  );
  if (leasePermissionRetained) {
    throw new Error("Dismissing the web-image handoff retained an optional host permission");
  }
  await fullWorkspacePage.close();
  await sidePanelPage.close();
  if (sidePanelNetworkRequests.length > 0) {
    throw new Error(`Side panel made remote requests: ${sidePanelNetworkRequests.join(", ")}`);
  }
  if (runNativeSidePanel)
    nativeSidePanelMetrics = await smokeNativeSidePanels(
      context,
      extensionWorkers[0].worker,
      extensionOrigin,
    );
  sidePanelMetrics = Object.freeze({
    ...sidePanelLayout,
    externalLinks: externalLinks.links.length,
    externalLinksVerified: true,
    fullWorkspaceLink: true,
    handoffIsolation: true,
    leaseDisconnectCleanup: true,
    openPanelOnActionClick: true,
    path: sidePanelConfiguration.options.path,
    widths: sidePanelWidths,
  });

  const page = await context.newPage();
  const networkRequests = [];
  const ordinaryExtensionRequests = [];
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
    else ordinaryExtensionRequests.push(request.url());
  });

  await page.goto(`${extensionOrigin}/converter.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#workspace").waitFor({ state: "visible" });
  runtimeIdentity = await page.evaluate(() => ({
    brands:
      "userAgentData" in globalThis.navigator
        ? globalThis.navigator.userAgentData.brands.map(({ brand, version }) => ({
            brand,
            version,
          }))
        : [],
    userAgent: globalThis.navigator.userAgent,
  }));
  const runtimeProduct = runtimeBrowserProduct(runtimeIdentity);
  const runtimeMajor = browserMajor(runtimeIdentity.userAgent);
  const runtimeProductMatches =
    runtimeProduct === expectedProduct ||
    (cdpEndpoint === undefined &&
      expectedProduct === "chrome" &&
      identity.product === "chrome" &&
      runtimeProduct === "chromium");
  if (expectedProduct !== "any" && !runtimeProductMatches) {
    throw new Error(
      `Expected ${expectedProduct} runtime, got ${runtimeProduct}: ${runtimeIdentity.userAgent}`,
    );
  }
  if (expectedMajor !== undefined && runtimeMajor !== expectedMajor) {
    throw new Error(`Expected browser major ${expectedMajor}, got ${runtimeIdentity.userAgent}`);
  }
  if (cdpEndpoint) {
    identity = Object.freeze({
      major: runtimeMajor,
      product: runtimeProduct,
      version: runtimeIdentity.userAgent,
    });
  }

  if (runAccessibility) {
    accessibilityMetrics.keyboard = await keyboardAccessibilityAudit(page);
    accessibilityMetrics.emptyWorkbench = await accessibilityAudit(page);
    requireNoAccessibilityViolations("Empty workbench", accessibilityMetrics.emptyWorkbench);
    await page.locator('[data-testid="theme-button"]').click();
    await page.waitForTimeout(250);
    accessibilityMetrics.emptyWorkbenchAlternateTheme = await accessibilityAudit(page);
    requireNoAccessibilityViolations(
      "Empty workbench alternate-theme",
      accessibilityMetrics.emptyWorkbenchAlternateTheme,
    );
    await page.locator('[data-testid="theme-button"]').click();
    await page.waitForTimeout(250);
  }

  if (ordinaryExtensionRequests.some((url) => /(?:\.wasm|(?:codec|archive)\.worker-)/u.test(url))) {
    throw new Error(
      "Ordinary converter-shell startup eagerly loaded a codec, Worker, or WASM asset",
    );
  }

  const manifest = await extensionWorkers[0].worker.evaluate(() => chrome.runtime.getManifest());
  if (manifest.manifest_version !== 3) throw new Error("Loaded extension is not Manifest V3");
  if (
    JSON.stringify([...manifest.permissions].sort()) !==
    JSON.stringify(["contextMenus", "sidePanel", "storage"])
  ) {
    throw new Error(`Unexpected loaded permissions: ${JSON.stringify(manifest.permissions)}`);
  }
  if (manifest.side_panel?.default_path !== "converter.html?surface=side-panel") {
    throw new Error(`Unexpected side panel path: ${manifest.side_panel?.default_path}`);
  }
  if (
    JSON.stringify([...manifest.optional_host_permissions].sort()) !==
    JSON.stringify(["https://*/*"])
  ) {
    throw new Error(
      `Unexpected optional host permissions: ${JSON.stringify(manifest.optional_host_permissions)}`,
    );
  }
  if (networkRequests.length > 0) {
    throw new Error(`Extension page made remote requests: ${networkRequests.join(", ")}`);
  }

  if (runWebImport) {
    const webImportPage = await context.newPage();
    await webImportPage.goto(`${extensionOrigin}/converter.html?surface=side-panel`, {
      waitUntil: "domcontentloaded",
    });
    await webImportPage.locator("#workspace").waitFor({ state: "visible" });
    await webImportPage.evaluate(
      async ({ sourceOrigin, sourceUrl }) => {
        const tab = await chrome.tabs.getCurrent();
        if (!Number.isSafeInteger(tab?.windowId)) throw new Error("Missing converter window ID");
        const parsed = new URL(sourceUrl);
        const descriptor = {
          createdAt: Date.now(),
          displayName: "web-smoke.png",
          kind: "remote",
          nonce: crypto.randomUUID(),
          permissionPattern: `${parsed.protocol}//${parsed.host}/*`,
          schemaVersion: 1,
          sourceOrigin,
          sourceUrl,
        };
        await chrome.storage.session.set({
          [`imgconvert.pendingImport.${tab.windowId}`]: descriptor,
        });
      },
      { sourceOrigin: webFixtureOrigin, sourceUrl: webFixtureUrl },
    );
    await webImportPage
      .locator('[data-testid="web-import-status"][data-state="ready"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    if (webFixtureRequests.length !== 0) {
      throw new Error("Web image was requested before the explicit authorization button");
    }
    await webImportPage.locator('[data-testid="web-import-authorize"]').click();
    if (expectWebImportDenied) {
      await webImportPage
        .locator('[data-testid="web-import-status"][data-state="denied"]')
        .waitFor({ state: "visible", timeout: 30_000 });
      const deniedPermission = await webImportPage.evaluate(
        async (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
        webFixtureOrigin,
      );
      if (deniedPermission || webFixtureRequests.length !== 0) {
        throw new Error("Denied web-image access retained permission or made a request");
      }
      webImportMetrics.permissionRetained = deniedPermission;
    } else {
      const importedWebImage = webImportPage
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "web-smoke.png" });
      try {
        await importedWebImage
          .locator('[data-testid="queue-state"][data-state="ready"]')
          .waitFor({ state: "visible", timeout: 30_000 });
      } catch (error) {
        const diagnostics = await webImportPage.evaluate(
          async (origin) => ({
            permission: await chrome.permissions.contains({ origins: [`${origin}/*`] }),
            status: globalThis.document.querySelector('[data-testid="web-import-status"]')
              ?.textContent,
            state: globalThis.document
              .querySelector('[data-testid="web-import-status"]')
              ?.getAttribute("data-state"),
          }),
          webFixtureOrigin,
        );
        throw new Error(
          `Authorized web-image import did not reach the queue: ${JSON.stringify({ diagnostics, requests: webFixtureRequests })}`,
          { cause: error },
        );
      }
      if (webFixtureRequests.length !== 1) {
        throw new Error(
          `Expected one authorized web-image request, found ${webFixtureRequests.length}`,
        );
      }
      const [webRequest] = webFixtureRequests;
      if (
        webRequest.method !== "GET" ||
        webRequest.url !== "/web-smoke.png" ||
        webRequest.authorization !== undefined ||
        webRequest.cookie !== undefined ||
        webRequest.referer !== undefined
      ) {
        throw new Error(`Unsafe web-image request metadata: ${JSON.stringify(webRequest)}`);
      }
      await webImportPage.waitForFunction(
        async (origin) => !(await chrome.permissions.contains({ origins: [`${origin}/*`] })),
        webFixtureOrigin,
      );
      webImportMetrics.permissionRetained = await webImportPage.evaluate(
        async (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
        webFixtureOrigin,
      );
      webImportMetrics.queueAdmitted = true;
      await importedWebImage.getByRole("button", { name: /Remove/u }).click();
    }
    const claimedSession = await webImportPage.evaluate(async () =>
      chrome.storage.session.get(null),
    );
    const claimedSessionText = JSON.stringify(claimedSession);
    if (
      claimedSessionText.includes("pendingImport") ||
      claimedSessionText.includes(webFixtureUrl)
    ) {
      throw new Error("Consumed web-image URL remained in extension session storage");
    }
    webImportMetrics.descriptorConsumed = true;
    await webImportPage.locator('[data-testid="web-import-dismiss"]').click();

    await webImportPage.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      if (!Number.isSafeInteger(tab?.windowId)) throw new Error("Missing converter window ID");
      const descriptor = {
        code: "unsupported-scheme",
        createdAt: Date.now(),
        kind: "blocked",
        nonce: crypto.randomUUID(),
        schemaVersion: 1,
        sourceLabel: "data",
      };
      await chrome.storage.session.set({
        [`imgconvert.pendingImport.${tab.windowId}`]: descriptor,
      });
    });
    await webImportPage
      .locator('[data-testid="web-import-status"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    if (
      (await webImportPage
        .locator('[data-testid="web-import-status"]')
        .getAttribute("data-state")) !== "ready"
    ) {
      throw new Error("Blocked web-image handoff did not reach its local-file fallback state");
    }
    const blockedSession = await webImportPage.evaluate(async () =>
      chrome.storage.session.get(null),
    );
    if (JSON.stringify(blockedSession).includes("pendingImport")) {
      throw new Error("Blocked web-image handoff was not consumed exactly once");
    }
    webImportMetrics.blockedDescriptorConsumed = true;
    await webImportPage.locator('[data-testid="web-import-dismiss"]').click();
    await webImportPage.close();
  }

  await page.locator('[data-testid="file-input"]').setInputFiles([
    { buffer: pngFixture, mimeType: "image/png", name: "extension-smoke-a.png" },
    { buffer: pngFixture, mimeType: "image/png", name: "extension-smoke-b.png" },
  ]);
  await page
    .locator('[data-testid="queue-state"][data-state="ready"]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  if ((await page.locator('[data-testid="queue-item"]').count()) !== 2) {
    throw new Error("Expected two admitted files in the visible extension queue");
  }
  if (runAccessibility) {
    accessibilityMetrics.populatedWorkbench = await accessibilityAudit(page);
    requireNoAccessibilityViolations(
      "Populated workbench",
      accessibilityMetrics.populatedWorkbench,
    );
    await page.locator('[data-testid="theme-button"]').click();
    await page.waitForTimeout(250);
    accessibilityMetrics.populatedWorkbenchAlternateTheme = await accessibilityAudit(page);
    requireNoAccessibilityViolations(
      "Populated workbench alternate-theme",
      accessibilityMetrics.populatedWorkbenchAlternateTheme,
    );
    await page.locator('[data-testid="theme-button"]').click();
    await page.waitForTimeout(250);
  }
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
  const protectedBeforeDownload = await page.evaluate(() => {
    const event = new globalThis.Event("beforeunload", { cancelable: true });
    return !globalThis.window.dispatchEvent(event) && event.defaultPrevented;
  });
  if (!protectedBeforeDownload) {
    throw new Error("Workbench did not protect converted results before download");
  }

  await page.locator('[data-testid="preview-result"]').first().click();
  await page.locator("dialog.preview-dialog[open]").waitFor({ state: "visible" });
  if ((await page.locator("dialog.preview-dialog img").count()) !== 2) {
    throw new Error("Expected original and converted images in the extension preview");
  }
  await page.keyboard.press("Escape");

  const resultDownloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-result"]').first().click();
  const resultDownload = await resultDownloadPromise;
  if (!resultDownload.suggestedFilename().endsWith(".webp")) {
    throw new Error(`Unexpected result filename: ${resultDownload.suggestedFilename()}`);
  }
  const resultBytes = await downloadBytes(resultDownload);
  if (
    resultBytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    resultBytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Downloaded extension result is not a valid WebP container");
  }

  const archiveDownloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="batch-download"]').click();
  const archiveDownload = await archiveDownloadPromise;
  if (archiveDownload.suggestedFilename() !== "imgconvert-results.zip") {
    throw new Error(`Unexpected archive filename: ${archiveDownload.suggestedFilename()}`);
  }
  const archiveBytes = await downloadBytes(archiveDownload);
  if (archiveBytes.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error("Downloaded extension batch is not a ZIP container");
  }

  await page.locator('[data-testid="file-input"]').setInputFiles({
    buffer: bmpFixture(),
    mimeType: "image/bmp",
    name: "extension-cancel.bmp",
  });
  await page
    .locator('[data-testid="queue-state"][data-state="ready"]')
    .last()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('input[name="outputFormat"][value="avif"]').check();
  await page.locator('[data-testid="convert-button"]').click();
  await page
    .locator('[data-testid="queue-state"][data-state="converting"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-testid="convert-button"]').click();
  await page
    .locator('[data-testid="queue-state"][data-state="cancelled"]')
    .waitFor({ state: "visible", timeout: 30_000 });

  const cancelledItem = page
    .locator('[data-testid="queue-item"]')
    .filter({ hasText: "extension-cancel.bmp" });
  await cancelledItem.getByRole("button", { name: /Retry/u }).click();
  await cancelledItem
    .locator('[data-testid="queue-state"][data-state="ready"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('input[name="outputFormat"][value="png"]').check();
  await page.locator('[data-testid="convert-button"]').click();
  await cancelledItem
    .locator('[data-testid="queue-state"][data-state="done"]')
    .waitFor({ state: "visible", timeout: 90_000 });
  const retryDownloadPromise = page.waitForEvent("download");
  await cancelledItem.locator('[data-testid="download-result"]').click();
  const retryDownload = await retryDownloadPromise;
  const retryBytes = await downloadBytes(retryDownload);
  if (retryBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Retried extension result is not a valid PNG container");
  }

  const protectedAfterDownloads = await page.evaluate(() => {
    const event = new globalThis.Event("beforeunload", { cancelable: true });
    return !globalThis.window.dispatchEvent(event) && event.defaultPrevented;
  });
  if (protectedAfterDownloads) {
    throw new Error("Workbench kept beforeunload protection after every result was downloaded");
  }

  const initialTheme = await page.locator(".extension-shell").getAttribute("data-theme");
  await page.locator('[data-testid="theme-button"]').click();
  await page.waitForFunction(
    (previousTheme) =>
      globalThis.document.querySelector(".extension-shell")?.getAttribute("data-theme") !==
      previousTheme,
    initialTheme,
  );
  const storedPreferences = await page.evaluate(async () => chrome.storage.local.get(null));
  const unexpectedPreferenceKeys = Object.keys(storedPreferences).filter(
    (key) => key !== "imgconvert.preferences" && key !== "imgconvert.preferences$",
  );
  if (unexpectedPreferenceKeys.length > 0) {
    throw new Error(
      `Extension storage contains unexpected keys: ${unexpectedPreferenceKeys.join(", ")}`,
    );
  }
  const serializedStorage = JSON.stringify(storedPreferences);
  for (const forbiddenContent of ["extension-smoke-a.png", "extension-smoke-b.png", "data:image"]) {
    if (serializedStorage.includes(forbiddenContent)) {
      throw new Error(`Extension storage persisted forbidden content: ${forbiddenContent}`);
    }
  }

  await page.setViewportSize({ width: 375, height: 900 });
  const responsiveLayout = await page.evaluate(() => {
    const imported = globalThis.document.querySelector(".import-panel")?.getBoundingClientRect();
    const queue = globalThis.document.querySelector(".queue-card")?.getBoundingClientRect();
    const settings = globalThis.document.querySelector(".settings-panel")?.getBoundingClientRect();
    const workbench = globalThis.document.querySelector(".workbench-grid");
    return {
      gridAreas: workbench ? globalThis.getComputedStyle(workbench).gridTemplateAreas : "",
      gridColumns: workbench ? globalThis.getComputedStyle(workbench).gridTemplateColumns : "",
      importBottom: imported?.bottom ?? -1,
      innerWidth: globalThis.innerWidth,
      media680: globalThis.matchMedia("(max-width: 680px)").matches,
      media900: globalThis.matchMedia("(max-width: 900px)").matches,
      overflowing: [...globalThis.document.querySelectorAll("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.getAttribute("class") ?? "",
            left: rect.left,
            right: rect.right,
            tag: element.tagName,
            width: rect.width,
          };
        })
        .filter(({ left, right }) => left < -0.5 || right > globalThis.innerWidth + 0.5)
        .slice(0, 12),
      overflow: globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      queuePosition: globalThis.getComputedStyle(globalThis.document.querySelector(".queue-card"))
        .position,
      queueBottom: queue?.bottom ?? -1,
      queueTop: queue?.top ?? -1,
      settingsTop: settings?.top ?? -1,
    };
  });
  if (
    responsiveLayout.overflow > 0 ||
    responsiveLayout.queueTop < responsiveLayout.importBottom ||
    responsiveLayout.settingsTop < responsiveLayout.queueBottom
  ) {
    throw new Error(`Invalid narrow workbench layout: ${JSON.stringify(responsiveLayout)}`);
  }

  const persistedTheme = await page.locator(".extension-shell").getAttribute("data-theme");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#workspace").waitFor({ state: "visible" });
  await page.waitForFunction(
    (expectedTheme) =>
      globalThis.document.querySelector(".extension-shell")?.getAttribute("data-theme") ===
      expectedTheme,
    persistedTheme,
  );
  if ((await page.locator('[data-testid="queue-item"]').count()) !== 0) {
    throw new Error(
      "Extension queue survived reload even though content must remain in page memory",
    );
  }
  await page.locator('[data-testid="reset-preferences"]').click();
  await page.locator('[data-testid="confirm-reset"]').click();
  await page.waitForFunction(async () => {
    const values = await chrome.storage.local.get(null);
    return Object.keys(values).length === 0;
  });

  if (runResource) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    resourceMetrics.dimensions = Object.freeze({ height: 4000, pixels: 24_000_000, width: 6000 });
    resourceMetrics.beforeImport = await processTreeMemory(profilePath);
    const resourceFixture = solidPngFixture(6000, 4000);
    resourceMetrics.inputBytes = resourceFixture.byteLength;
    await page.locator('[data-testid="file-input"]').setInputFiles({
      buffer: resourceFixture,
      mimeType: "image/png",
      name: "extension-resource-24mp.png",
    });
    const resourceItem = page
      .locator('[data-testid="queue-item"]')
      .filter({ hasText: "extension-resource-24mp.png" });
    await resourceItem
      .locator('[data-testid="queue-state"][data-state="ready"]')
      .waitFor({ state: "visible", timeout: 120_000 });
    if ((await resourceItem.locator(".thumbnail img").count()) !== 0) {
      throw new Error("24 MP source was decoded eagerly for the queue thumbnail");
    }
    resourceMetrics.afterProbe = await processTreeMemory(profilePath);

    await page.locator('input[name="outputFormat"][value="png"]').check();
    await page.locator('[data-testid="convert-button"]').click();
    await resourceItem
      .locator('[data-testid="queue-state"][data-state="done"]')
      .waitFor({ state: "visible", timeout: 600_000 });
    if ((await resourceItem.locator(".thumbnail img").count()) !== 0) {
      throw new Error("24 MP result was decoded eagerly for the queue thumbnail");
    }
    resourceMetrics.afterConversion = await processTreeMemory(profilePath);

    const resourceDownloadPromise = page.waitForEvent("download");
    await resourceItem.locator('[data-testid="download-result"]').click();
    const resourceDownload = await resourceDownloadPromise;
    const resourceBytes = await downloadBytes(resourceDownload);
    if (
      resourceBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      resourceBytes.readUInt32BE(16) !== 6000 ||
      resourceBytes.readUInt32BE(20) !== 4000
    ) {
      throw new Error("24 MP conversion did not produce a 6000 × 4000 PNG");
    }
    resourceMetrics.outputBytes = resourceBytes.byteLength;
    await resourceItem.locator(".item-actions button").last().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#workspace").waitFor({ state: "visible" });
    await page.waitForTimeout(1000);
    resourceMetrics.afterRecovery = await processTreeMemory(profilePath);
    const { afterConversion, afterRecovery, beforeImport } = resourceMetrics;
    if (afterConversion && afterRecovery && beforeImport) {
      const maxResidualBytes = 192 * 1024 * 1024;
      const minReclaimedBytes = 128 * 1024 * 1024;
      const reclaimedBytes = afterConversion.rssBytes - afterRecovery.rssBytes;
      const residualBytes = afterRecovery.rssBytes - beforeImport.rssBytes;
      resourceMetrics.memory = Object.freeze({
        maxResidualBytes,
        minReclaimedBytes,
        passed: residualBytes <= maxResidualBytes && reclaimedBytes >= minReclaimedBytes,
        reclaimedBytes,
        residualBytes,
      });
      if (!resourceMetrics.memory.passed) {
        throw new Error(
          `24 MP browser memory did not recover within budget: ${JSON.stringify(resourceMetrics.memory)}`,
        );
      }
    } else {
      resourceMetrics.memory = Object.freeze({
        passed: null,
        skipped: "Browser process-tree RSS is unavailable outside a local Linux launch.",
      });
    }
    if ((await page.locator('[data-testid="queue-item"]').count()) !== 0) {
      throw new Error("24 MP queue content survived removal and page recovery");
    }
    const resourceStorage = JSON.stringify(
      await page.evaluate(async () => ({
        local: await chrome.storage.local.get(null),
        session: await chrome.storage.session.get(null),
      })),
    );
    if (resourceStorage.includes("extension-resource-24mp.png")) {
      throw new Error("24 MP file name remained in extension storage after recovery");
    }
    resourceMetrics.passed = true;
  }

  let runtimeSummary = `; visible workbench converted 2 PNG files, previewed, downloaded WebP + ZIP, cancelled/retried BMP→PNG, protected unsaved results, persisted/cleared preferences without content, and passed 375px layout`;
  if (runRuntime) {
    await page.close();
    const runtimePage = await context.newPage();
    runtimePage.on("request", (request) => {
      if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
    });
    await runtimePage.goto(`${extensionOrigin}/converter.html?__imgconvert_runtime_check=1`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await runtimePage.waitForFunction(
        () => {
          const state = globalThis.document
            .querySelector("#runtime-diagnostics")
            ?.getAttribute("data-state");
          return state === "passed" || state === "failed";
        },
        undefined,
        { timeout: 600_000 },
      );
    } catch (error) {
      const progress = await runtimePage
        .locator("#runtime-diagnostics")
        .textContent()
        .catch(() => null);
      throw new Error(`Extension runtime diagnostics timed out at ${progress ?? "unknown stage"}`, {
        cause: error,
      });
    }
    const diagnostics = await runtimePage.locator("#runtime-diagnostics").evaluate((element) => ({
      state: element.getAttribute("data-state"),
      text: element.textContent ?? "",
    }));
    if (diagnostics.state !== "passed") {
      throw new Error(`Extension runtime diagnostics failed: ${diagnostics.text}`);
    }
    const result = JSON.parse(diagnostics.text);
    if (
      result.inputs !== 8 ||
      result.outputs !== 4 ||
      result.conversions !== 32 ||
      result.archiveEntries !== 32 ||
      !Number.isSafeInteger(result.archiveBytes) ||
      result.archiveBytes < 1
    ) {
      throw new Error(`Unexpected extension runtime diagnostics: ${diagnostics.text}`);
    }
    runtimeSummary += `; runtime matrix ${result.inputs}×${result.outputs}, ZIP ${result.archiveBytes} bytes`;
    await runtimePage.close();
  }
  if (runEnvironment) {
    environmentMetrics = await smokeEnvironment(
      context,
      extensionOrigin,
      bmpFixture(256, 256),
      join(projectRoot, ".output", "reports", `environment-${browser}`),
    );
  }
  const unexpectedNetworkRequests = networkRequests.filter(
    (url) => !runWebImport || expectWebImportDenied || url !== webFixtureUrl,
  );
  if (unexpectedNetworkRequests.length > 0) {
    throw new Error(
      `Extension page made unexpected remote requests: ${unexpectedNetworkRequests.join(", ")}`,
    );
  }
  if (browserErrors.length > 0) throw new Error(browserErrors.join("\n"));

  const webImportSummary = expectWebImportDenied
    ? "; denied web-image access made no request and retained no permission"
    : runWebImport
      ? "; one explicitly authorized credential-free web image was imported and its permission removed"
      : " with no remote requests";
  const offlineSummary = runOffline ? "; fresh profile remained offline" : "";
  const accessibilitySummary = runAccessibility
    ? `; accessibility ${accessibilityMetrics.emptyWorkbench.passes + accessibilityMetrics.populatedWorkbench.passes} rule passes, keyboard path passed`
    : "";
  const resourceSummary = runResource
    ? `; 24 MP PNG converted and recovered${resourceMetrics.afterConversion ? ` at ${resourceMetrics.afterConversion.rssBytes} browser-tree RSS bytes` : ""}`
    : "";
  console.log(
    `${identity.product} ${identity.version} using ${browser}-mv3 loaded at ${extensionOrigin}; side panel 320–480 px, official links, isolated handoffs, permission-lease cleanup, and full-workspace switch passed${webImportSummary}${offlineSummary}${runtimeSummary}${accessibilitySummary}${resourceSummary}`,
  );
} catch (error) {
  smokeError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  throw error;
} finally {
  await context?.close().catch(() => undefined);
  if (webFixtureServer) await closeServer(webFixtureServer).catch(() => undefined);
  if (webFixtureTlsPath) await rm(webFixtureTlsPath, { force: true, recursive: true });
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          accessibility: runAccessibility ? accessibilityMetrics : undefined,
          environment: environmentMetrics,
          build: { fingerprint: fingerprint.sha256, files: fingerprint.files, target: browser },
          browserErrors,
          browserInternalMessages,
          executable: {
            major: identity.major,
            path: cdpEndpoint
              ? (process.env.IMGCONVERT_REMOTE_EXECUTABLE ?? "remote CDP")
              : executablePath,
            product: identity.product,
            version: identity.version,
          },
          expected: { major: expectedMajor, product: expectedProduct },
          failure: smokeError,
          generatedAt: new Date().toISOString(),
          modes: {
            accessibility: runAccessibility,
            offline: runOffline,
            nativeSidePanel: runNativeSidePanel,
            resource: runResource,
            runtime: runRuntime,
            environment: runEnvironment,
            webImport: runWebImport,
            webImportDenied: expectWebImportDenied,
          },
          passed: smokeError === undefined,
          resource: runResource ? resourceMetrics : undefined,
          runtimeIdentity,
          schemaVersion: 2,
          sidePanel: sidePanelMetrics,
          nativeSidePanel: nativeSidePanelMetrics,
          webImport: webImportMetrics
            ? {
                ...webImportMetrics,
                requestCount: webFixtureRequests.length,
                requests: webFixtureRequests.map((request) => ({
                  authorizationPresent: request.authorization !== undefined,
                  cookiePresent: request.cookie !== undefined,
                  method: request.method,
                  path: request.url,
                  refererPresent: request.referer !== undefined,
                })),
              }
            : undefined,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  await connectedBrowser?.close().catch(() => undefined);
  await rm(profilePath, { force: true, recursive: true });
}
