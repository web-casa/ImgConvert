// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");
const failures = [];

const packageJson = readJson(path.join(repoRoot, "package.json"));
const ci = readWorkflow("ci.yml");
const linuxRelease = readWorkflow("release-linux.yml");
const updaterRelease = readWorkflow("release-updater.yml");
const updaterUpgradeSmoke = readWorkflow("updater-upgrade-smoke.yml");
const macosSmoke = readWorkflow("macos-smoke.yml");
const windowsSmoke = readWorkflow("windows-smoke.yml");
const windowsStoreRelease = readWorkflow("windows-store-release.yml");
const pages = readWorkflow("pages.yml");

const allWorkflows = [
  ["ci.yml", ci],
  ["release-linux.yml", linuxRelease],
  ["release-updater.yml", updaterRelease],
  ["updater-upgrade-smoke.yml", updaterUpgradeSmoke],
  ["macos-smoke.yml", macosSmoke],
  ["windows-smoke.yml", windowsSmoke],
  ["windows-store-release.yml", windowsStoreRelease],
  ["pages.yml", pages],
];

for (const [name, text] of allWorkflows) {
  checkPublicFreeRunnerPolicy(name, text);
}

checkAutomaticLinuxCiWorkflow();
checkLinuxReleaseWorkflow();
checkManualWorkflow("release-updater.yml", updaterRelease);
checkManualWorkflow("updater-upgrade-smoke.yml", updaterUpgradeSmoke);
checkManualWorkflow("macos-smoke.yml", macosSmoke);
checkManualWorkflow("windows-smoke.yml", windowsSmoke);
checkManualWorkflow("windows-store-release.yml", windowsStoreRelease);
checkUpdaterReleaseWorkflow();
checkUpdaterUpgradeSmokeWorkflow();
checkStandardPlatformWorkflow("macos-smoke.yml", macosSmoke, "macOS", "macos-15");
checkStandardPlatformWorkflow("windows-smoke.yml", windowsSmoke, "Windows", "windows-latest");
checkWindowsStoreReleaseWorkflow();
checkStandardPlatformWorkflow(
  "windows-store-release.yml",
  windowsStoreRelease,
  "Windows Store",
  "windows-latest",
);
checkPagesWorkflow();

if (!packageJson.scripts?.["ci:cost:check"]?.includes("check-ci-cost-guardrails.mjs")) {
  failures.push("package.json must expose ci:cost:check");
}
if (!packageJson.scripts?.["quality:security"]?.includes("ci:cost:check")) {
  failures.push("quality:security must include ci:cost:check");
}

if (failures.length > 0) {
  console.error("CI cost guardrail check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("CI cost guardrail check passed (public-repo standard runners only).");

function checkPublicFreeRunnerPolicy(name, text) {
  if (!text.includes("workflow_dispatch:")) {
    failures.push(`${name} must be manually dispatchable`);
  }
  if (hasYamlKeyLine(text, "schedule")) {
    failures.push(`${name} must not use schedule trigger`);
  }
  if (/\bconfirm_paid_runner\b/.test(text) || /\bconfirm_runner\b/.test(text)) {
    failures.push(`${name} must not require a paid-runner confirmation input`);
  }
  if (/\bpaid\b/i.test(text)) {
    failures.push(`${name} must not describe standard public runners as paid`);
  }
  const paidRunnerPattern = /runs-on:\s*[^\n#]*(?:large|xlarge|gpu|64core|32core|16core)/i;
  if (paidRunnerPattern.test(text)) {
    failures.push(`${name} must not use paid larger runner labels`);
  }
  for (const match of text.matchAll(/runs-on:\s*([^\n#]+)/g)) {
    const runner = match[1].trim();
    if (!isAllowedRunner(runner)) {
      failures.push(`${name} uses unsupported GitHub-hosted runner label: ${runner}`);
    }
  }
}

function isAllowedRunner(runner) {
  return [
    "ubuntu-24.04",
    "ubuntu-24.04-arm",
    "windows-latest",
    "macos-15",
    "${{ matrix.runner }}",
  ].includes(runner);
}

function checkAutomaticLinuxCiWorkflow() {
  requireBooleanInputDefault(ci, "platform_checks", false, "ci.yml");
  requireBooleanInputDefault(ci, "fuzz_corpus", false, "ci.yml");
  requireBooleanInputDefault(ci, "package_smoke", false, "ci.yml");
  requireBooleanInputDefault(ci, "package_smoke_arm64", false, "ci.yml");

  for (const trigger of ["push", "pull_request"]) {
    if (!hasYamlKeyLine(ci, trigger)) {
      failures.push(`ci.yml must run automatically on ${trigger}`);
    }
  }
  if (!ci.includes("name: Fuzz Corpus Replay")) {
    failures.push("ci.yml must expose a fuzz corpus replay job");
  }
  if (!ci.includes("github.event_name != 'workflow_dispatch' || inputs.fuzz_corpus")) {
    failures.push("ci.yml fuzz corpus job must run automatically and stay toggleable on dispatch");
  }
  if (!ci.includes("pnpm run fuzz:ci")) {
    failures.push("ci.yml fuzz corpus job must run pnpm run fuzz:ci");
  }
  if (!ci.includes("inputs.package_smoke_arm64")) {
    failures.push("ci.yml package smoke matrix must require package_smoke_arm64 on dispatch");
  }
  if (!ci.includes("ubuntu-24.04-arm")) {
    failures.push("ci.yml must keep the free public arm64 runner explicit when enabled");
  }
}

function checkLinuxReleaseWorkflow() {
  requireBooleanInputDefault(linuxRelease, "docker_smoke", false, "release-linux.yml");
  requireBooleanInputDefault(linuxRelease, "build_arm64", false, "release-linux.yml");

  if (!hasYamlKeyLine(linuxRelease, "push") || !linuxRelease.includes('tags: ["v*"]')) {
    failures.push("release-linux.yml must build automatically for v* tags");
  }
  if (!linuxRelease.includes("inputs.build_arm64")) {
    failures.push("release-linux.yml must require build_arm64 on dispatch");
  }
  if (!linuxRelease.includes("ubuntu-24.04-arm")) {
    failures.push("release-linux.yml must keep the free public arm64 runner explicit when enabled");
  }
  if (!linuxRelease.includes("inputs.docker_smoke")) {
    failures.push("release-linux.yml Docker smoke must be gated by docker_smoke input");
  }
}

function checkManualWorkflow(name, text) {
  for (const trigger of ["push", "pull_request", "pull_request_target"]) {
    if (hasYamlKeyLine(text, trigger)) {
      failures.push(`${name} must remain manual-only`);
    }
  }
}

function checkUpdaterReleaseWorkflow() {
  requireBooleanInputDefault(updaterRelease, "publish_release", false, "release-updater.yml");
  requireBooleanInputDefault(updaterRelease, "draft_release", true, "release-updater.yml");
  requireBooleanInputDefault(updaterRelease, "prerelease", false, "release-updater.yml");

  if (!updaterRelease.includes("pnpm run release:linux:updater")) {
    failures.push("release-updater.yml must build signed Linux updater artifacts");
  }
  if (!updaterRelease.includes("pnpm run release:updater:manifest")) {
    failures.push("release-updater.yml must generate latest.json");
  }
  if (!updaterRelease.includes("pnpm run release:updater:verify")) {
    failures.push("release-updater.yml must verify latest.json before upload");
  }
  if (!updaterRelease.includes("inputs.publish_release")) {
    failures.push("release-updater.yml publishing must be gated by publish_release");
  }
}

function checkUpdaterUpgradeSmokeWorkflow() {
  if (!updaterUpgradeSmoke.includes("runs-on: ubuntu-24.04")) {
    failures.push("updater-upgrade-smoke.yml must keep the GitHub-hosted runner explicit");
  }
  if (!updaterUpgradeSmoke.includes("smoke-tauri-in-app-updater.mjs")) {
    failures.push("updater-upgrade-smoke.yml must run the in-app updater smoke script");
  }
  if (!updaterUpgradeSmoke.includes("xdotool") || !updaterUpgradeSmoke.includes("xvfb")) {
    failures.push("updater-upgrade-smoke.yml must install xdotool and xvfb");
  }
}

function checkStandardPlatformWorkflow(name, text, label, runner) {
  if (!text.includes(`runs-on: ${runner}`)) {
    failures.push(`${name} must keep ${label} standard runner explicit`);
  }
}

function checkWindowsStoreReleaseWorkflow() {
  for (const marker of [
    "release:windows:msix",
    "release:windows:msix:smoke",
    'IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1"',
    'IMGCONVERT_DISABLE_UPDATER: "1"',
    "imgconvert-windows-x64-msix-submission",
  ]) {
    if (!windowsStoreRelease.includes(marker)) {
      failures.push(`windows-store-release.yml missing marker: ${marker}`);
    }
  }
}

function checkPagesWorkflow() {
  for (const marker of [
    "github.event.repository.has_pages == true",
    "actions/configure-pages@v5",
    "actions/upload-pages-artifact@v4",
    "actions/deploy-pages@v4",
    "path: pages",
    "name: github-pages",
  ]) {
    if (!pages.includes(marker)) {
      failures.push(`pages.yml missing marker: ${marker}`);
    }
  }
}

function requireBooleanInputDefault(text, inputName, expected, workflowName) {
  const inputBlock = text.match(
    new RegExp(`\\n\\s{6}${escapeRegExp(inputName)}:\\n(?<body>(?:\\s{8}.+\\n)+)`),
  );
  if (!inputBlock?.groups?.body) {
    failures.push(`${workflowName} must define workflow_dispatch input ${inputName}`);
    return;
  }
  if (!new RegExp(`\\n\\s{8}type:\\s*boolean\\b`).test(inputBlock.groups.body)) {
    failures.push(`${workflowName} input ${inputName} must be boolean`);
  }
  if (!new RegExp(`\\n\\s{8}default:\\s*${expected}\\b`).test(inputBlock.groups.body)) {
    failures.push(`${workflowName} input ${inputName} must default to ${expected}`);
  }
}

function hasYamlKeyLine(text, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  return text.split(/\r?\n/).some((line) => pattern.test(line));
}

function readWorkflow(name) {
  return readFileSync(path.join(workflowsDir, name), "utf8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
