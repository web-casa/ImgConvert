// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson("package.json");
const failures = [];

const snapcraft = readText("snap/snapcraft.yaml");
const appImageHubEntry = readText("packaging/appimagehub/ImgConvert").trim();
const metainfoPath = "packaging/appimagehub/com.ivmm.imgconvert.metainfo.xml";
const metainfo = readText(metainfoPath);
const aurTemplate = readText("packaging/aur/PKGBUILD.template");
const snapWorkflow = readText(".github/workflows/snap-store-release.yml");
const linuxWorkflow = readText(".github/workflows/release-linux.yml");
const updaterWorkflow = readText(".github/workflows/release-updater.yml");

if (!snapcraft.includes(`version: "${packageJson.version}"`)) {
  failures.push("snap version must match package.json");
}
if (!metainfo.includes(`<release version="${packageJson.version}"`)) {
  failures.push("AppImageHub AppStream release version must match package.json");
}
if (appImageHubEntry !== "https://github.com/web-casa/ImgConvert") {
  failures.push("AppImageHub catalog entry must contain only the canonical GitHub repository URL");
}

for (const marker of [
  "pkgname=imgconvert-bin",
  "arch=('x86_64')",
  "@VERSION@",
  "@APPIMAGE_SHA256@",
  "ImgConvert-${pkgver}-x86_64.AppImage",
  "--appimage-extract",
]) {
  if (!aurTemplate.includes(marker)) {
    failures.push(`AUR PKGBUILD template missing marker: ${marker}`);
  }
}
for (const denied of ["sha256sums=('SKIP')", "aarch64", "arm64"]) {
  if (aurTemplate.includes(denied)) {
    failures.push(`AUR PKGBUILD template contains denied marker: ${denied}`);
  }
}

for (const marker of [
  "workflow_dispatch:",
  "publish_snap",
  "default: false",
  "snapcore/action-build@3bdaa03e1ba6bf59a65f84a751d943d549a54e79",
  "snapcore/action-publish@214b86e5ca036ead1668c79afb81e550e6c54d40",
  "SNAP_STORE_LOGIN",
  "inputs.publish_snap",
  "retention-days: 7",
]) {
  if (!snapWorkflow.includes(marker)) {
    failures.push(`Snap Store workflow missing marker: ${marker}`);
  }
}
for (const denied of ["push:", "pull_request:", "schedule:"]) {
  if (hasYamlKeyLine(snapWorkflow, denied.slice(0, -1))) {
    failures.push(`Snap Store workflow must remain manual-only: ${denied}`);
  }
}

for (const [name, workflow] of [
  ["release-linux.yml", linuxWorkflow],
  ["release-updater.yml", updaterWorkflow],
]) {
  if (!workflow.includes("ubuntu-22.04")) {
    failures.push(`${name} must build AppImage artifacts on the Ubuntu 22.04 baseline`);
  }
}
for (const marker of [
  "release:appimagehub:prepare",
  "release:aur:prepare",
  "target/appimagehub/*.AppImage",
  "target/aur/imgconvert-bin",
]) {
  if (!updaterWorkflow.includes(marker)) {
    failures.push(`Updater workflow missing Linux market marker: ${marker}`);
  }
}
if (
  !/uses:\s*actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a[\s\S]*?include-hidden-files:\s*true[\s\S]*?target\/aur\/imgconvert-bin/u.test(
    updaterWorkflow,
  )
) {
  failures.push("Updater workflow must include hidden AUR files in its downloadable artifact");
}

runCheck("node", ["scripts/check-snap-package.mjs"], "Snap source check");
if (commandExists("appstreamcli")) {
  runCheck("appstreamcli", ["validate", "--no-net", metainfoPath], "AppStream validation");
}

if (failures.length > 0) {
  console.error("Linux market packaging check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Linux market packaging check passed (Snap Store, AppImageHub, AUR).");

function runCheck(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    failures.push(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

function commandExists(command) {
  return (
    spawnSync("sh", ["-c", `command -v ${quoteShell(command)} >/dev/null 2>&1`], {
      stdio: "ignore",
    }).status === 0
  );
}

function hasYamlKeyLine(text, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`, "mu").test(text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteShell(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readJson(relative) {
  return JSON.parse(readText(relative));
}

function readText(relative) {
  const file = path.join(repoRoot, relative);
  if (!existsSync(file)) {
    failures.push(`missing file: ${relative}`);
    return "";
  }
  return readFileSync(file, "utf8");
}
