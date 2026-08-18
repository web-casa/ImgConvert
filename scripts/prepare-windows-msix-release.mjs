// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = os.platform() === "win32";

const options = {
  allowNonWindows: false,
  allowMissingStoreEnv: false,
};

for (const arg of process.argv.slice(2)) {
  if (arg === "--") {
    continue;
  } else if (arg === "--allow-non-windows") {
    options.allowNonWindows = true;
  } else if (arg === "--allow-missing-store-env") {
    options.allowMissingStoreEnv = true;
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}

if (!isWindows && !options.allowNonWindows) {
  fail(
    "Windows MSIX preparation must run on Windows. Pass --allow-non-windows only for preflight.",
  );
}
if (!truthy(process.env.IMGCONVERT_DISABLE_EXTERNAL_CODECS)) {
  fail("MSIX/Store preparation requires IMGCONVERT_DISABLE_EXTERNAL_CODECS=1");
}

const requiredEnv = [
  "WINDOWS_STORE_IDENTITY_NAME",
  "WINDOWS_STORE_PUBLISHER",
  "WINDOWS_STORE_PUBLISHER_DISPLAY_NAME",
];
const missing = requiredEnv.filter((name) => !envOverride(name));
if (missing.length > 0 && !options.allowMissingStoreEnv) {
  console.warn(
    `using committed Partner Center identity defaults; set ${missing.join(", ")} to override`,
  );
}

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = storeVersion(envOverride("WINDOWS_STORE_VERSION") ?? packageJson.version);
const replacements = {
  WINDOWS_STORE_IDENTITY_NAME:
    envOverride("WINDOWS_STORE_IDENTITY_NAME") ?? "53660AlanM.ImgConvert",
  WINDOWS_STORE_PUBLISHER:
    envOverride("WINDOWS_STORE_PUBLISHER") ?? "CN=84AC3716-04E0-4D67-8951-0D3E51674CA0",
  WINDOWS_STORE_PUBLISHER_DISPLAY_NAME:
    envOverride("WINDOWS_STORE_PUBLISHER_DISPLAY_NAME") ?? "AlanM.",
  WINDOWS_STORE_VERSION: version,
};

function envOverride(name) {
  const value = String(process.env[name] ?? "").trim();
  return value || undefined;
}

const templatePath = path.join(
  repoRoot,
  "packaging",
  "windows",
  "msix",
  "AppxManifest.xml.template",
);
const template = readFileSync(templatePath, "utf8");
for (const token of [
  "runFullTrust",
  "Windows.FullTrustApplication",
  "desktop6:Extension",
  "TargetDeviceFamily",
  'ProcessorArchitecture="x64"',
]) {
  if (!template.includes(token)) {
    fail(`MSIX manifest template must include ${token}`);
  }
}

let manifest = template;
for (const [key, value] of Object.entries(replacements)) {
  manifest = manifest.replaceAll(`{{${key}}}`, xmlEscape(value));
}

const outputDir = path.join(repoRoot, "src-tauri", "target", "windows-msix");
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "AppxManifest.xml");
writeFileSync(outputPath, manifest);
console.log(`prepared ${path.relative(repoRoot, outputPath)}`);

if (isWindows) {
  for (const tool of ["makeappx.exe", "signtool.exe"]) {
    if (!toolExists(tool)) {
      console.warn(
        `${tool} was not found in PATH; install Windows SDK before packaging/submission.`,
      );
    }
  }
}

function storeVersion(value) {
  const parts = String(value).split(".");
  if (
    parts.length > 4 ||
    parts.some((part) => !/^\d+$/.test(part) || Number.parseInt(part, 10) > 65535)
  ) {
    fail(`invalid Windows Store version: ${value} (expected up to four decimal components)`);
  }
  const canonical = parts.map((part) => String(Number.parseInt(part, 10)));
  while (canonical.length < 4) {
    canonical.push("0");
  }
  if (canonical[0] === "0" || canonical[3] !== "0") {
    fail(
      `invalid Windows Store version: ${canonical.join(".")} (major must be >= 1 and the fourth component must be 0; set WINDOWS_STORE_VERSION, e.g. 1.0.0.0)`,
    );
  }
  return canonical.join(".");
}

function toolExists(tool) {
  const paths = (process.env.Path ?? process.env.PATH ?? "").split(path.delimiter);
  return paths.some((dir) => existsSync(path.join(dir, tool)));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printHelp() {
  console.log(`Usage: node scripts/prepare-windows-msix-release.mjs [options]

Options:
  --allow-non-windows          Allow non-Windows manifest generation preflight.
  --allow-missing-store-env    Legacy no-op; identity defaults are always available.

Environment:
  IMGCONVERT_DISABLE_EXTERNAL_CODECS=1  Required.
  WINDOWS_STORE_IDENTITY_NAME           Optional override of the committed identity.
  WINDOWS_STORE_PUBLISHER               Optional override of the committed publisher.
  WINDOWS_STORE_PUBLISHER_DISPLAY_NAME  Optional override of the committed display name.
  WINDOWS_STORE_VERSION                 Optional four-part Store version override.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
