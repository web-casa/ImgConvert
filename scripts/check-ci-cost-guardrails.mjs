// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
const macosRelease = readWorkflow("macos-release.yml");
const macosMasRelease = readWorkflow("macos-mas-release.yml");
const macosNotarizationFinalize = readWorkflow("macos-notarization-finalize.yml");
const windowsSmoke = readWorkflow("windows-smoke.yml");
const windowsStoreRelease = readWorkflow("windows-store-release.yml");
const snapStoreMetadata = readWorkflow("snap-store-metadata.yml");
const snapStoreRelease = readWorkflow("snap-store-release.yml");
const pages = readWorkflow("pages.yml");

const allWorkflows = [
  ["ci.yml", ci],
  ["release-linux.yml", linuxRelease],
  ["release-updater.yml", updaterRelease],
  ["updater-upgrade-smoke.yml", updaterUpgradeSmoke],
  ["macos-smoke.yml", macosSmoke],
  ["macos-release.yml", macosRelease],
  ["macos-mas-release.yml", macosMasRelease],
  ["macos-notarization-finalize.yml", macosNotarizationFinalize],
  ["windows-smoke.yml", windowsSmoke],
  ["windows-store-release.yml", windowsStoreRelease],
  ["snap-store-metadata.yml", snapStoreMetadata],
  ["snap-store-release.yml", snapStoreRelease],
  ["pages.yml", pages],
];

for (const [name, text] of allWorkflows) {
  checkPublicFreeRunnerPolicy(name, text);
}
for (const name of readdirSync(workflowsDir)
  .filter((entry) => entry.endsWith(".yml"))
  .sort()) {
  checkGitHubActionsAreCommitPinned(name, readWorkflow(name));
}

checkAutomaticLinuxCiWorkflow();
checkUbuntuAptBootstrap();
checkLinuxReleaseWorkflow();
checkManualWorkflow("release-updater.yml", updaterRelease);
checkManualWorkflow("updater-upgrade-smoke.yml", updaterUpgradeSmoke);
checkManualWorkflow("macos-smoke.yml", macosSmoke);
checkManualWorkflow("macos-release.yml", macosRelease);
checkManualWorkflow("macos-mas-release.yml", macosMasRelease);
checkManualWorkflow("macos-notarization-finalize.yml", macosNotarizationFinalize);
checkManualWorkflow("windows-smoke.yml", windowsSmoke);
checkManualWorkflow("windows-store-release.yml", windowsStoreRelease);
checkManualWorkflow("snap-store-metadata.yml", snapStoreMetadata);
checkManualWorkflow("snap-store-release.yml", snapStoreRelease);
checkUpdaterReleaseWorkflow();
checkUpdaterUpgradeSmokeWorkflow();
checkWindowsSmokeWorkflow();
checkStandardPlatformWorkflow("macos-smoke.yml", macosSmoke, "macOS", "macos-15");
checkMacosSmokeWorkflow();
checkMacosDmgReleaseWorkflow();
checkStandardPlatformWorkflow(
  "macos-release.yml",
  macosRelease,
  "macOS DMG Release matrix",
  "${{ matrix.runner }}",
);
checkMacosMasReleaseWorkflow();
checkStandardPlatformWorkflow(
  "macos-mas-release.yml",
  macosMasRelease,
  "macOS MAS Release",
  "macos-15",
);
checkMacosNotarizationFinalizeWorkflow();
checkStandardPlatformWorkflow(
  "macos-notarization-finalize.yml",
  macosNotarizationFinalize,
  "macOS notarization finalizer",
  "macos-15",
);
checkStandardPlatformWorkflow(
  "windows-smoke.yml",
  windowsSmoke,
  "Windows matrix",
  "${{ matrix.runner }}",
);
checkWindowsStoreReleaseWorkflow();
checkSnapStoreMetadataWorkflow();
checkSnapStoreReleaseWorkflow();
checkStandardPlatformWorkflow(
  "windows-store-release.yml",
  windowsStoreRelease,
  "Windows Store",
  "${{ matrix.runner }}",
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

function checkGitHubActionsAreCommitPinned(name, text) {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s+)?uses:\s*([^@\s]+)@([^\s#]+)/u);
    if (!match) {
      continue;
    }
    const [, action, ref] = match;
    if (!/^[a-f0-9]{40}$/iu.test(ref)) {
      failures.push(`${name}:${index + 1} must pin ${action} to a full commit SHA`);
    }
  }
}

function isAllowedRunner(runner) {
  return [
    "ubuntu-24.04",
    "ubuntu-24.04-arm",
    "ubuntu-22.04",
    "ubuntu-22.04-arm",
    "windows-latest",
    "windows-11-arm",
    "macos-15",
    "macos-15-intel",
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
  for (const marker of [
    "pnpm run ci:cost:check",
    "pnpm run release:flatpak:verify",
    "cargo deny --manifest-path Cargo.toml --config src-tauri/deny.toml check bans sources advisories",
  ]) {
    if (!ci.includes(marker)) {
      failures.push(`ci.yml security job must include ${marker}`);
    }
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
  if (!ci.includes("ubuntu-22.04-arm")) {
    failures.push("ci.yml must keep the free public arm64 runner explicit when enabled");
  }
}

function checkUbuntuAptBootstrap() {
  const bootstrapPath = path.join(repoRoot, "scripts", "ci-install-apt-packages.sh");
  if (!existsSync(bootstrapPath)) {
    failures.push("Ubuntu native dependency bootstrap script is missing");
    return;
  }
  if (process.platform !== "win32" && (statSync(bootstrapPath).mode & 0o111) === 0) {
    failures.push("Ubuntu native dependency bootstrap script must be executable");
  }
  const bootstrap = readFileSync(bootstrapPath, "utf8");
  for (const marker of [
    "update_attempts=3",
    "update_timeout_seconds=180",
    "install_timeout_seconds=600",
    "timeout --kill-after",
    "apt-get update",
    "apt-get install",
    "GITHUB_ACTIONS",
    "RUNNER_ENVIRONMENT",
    "github-hosted",
    "azure.archive.ubuntu.com",
    "archive.ubuntu.com",
    "restore_ubuntu_runner_mirror",
    "restore_status",
  ]) {
    if (!bootstrap.includes(marker)) {
      failures.push(`Ubuntu native dependency bootstrap is missing marker: ${marker}`);
    }
  }
  const invocation = "scripts/ci-install-apt-packages.sh";
  for (const [name, workflow, expectedCount] of [
    ["ci.yml", ci, 4],
    ["release-linux.yml", linuxRelease, 1],
    ["release-updater.yml", updaterRelease, 1],
    ["updater-upgrade-smoke.yml", updaterUpgradeSmoke, 1],
    ["snap-store-metadata.yml", snapStoreMetadata, 1],
  ]) {
    const invocationCount = workflow.split(invocation).length - 1;
    if (invocationCount !== expectedCount) {
      failures.push(
        `${name} must use the bounded Ubuntu dependency bootstrap ${expectedCount} time(s), found ${invocationCount}`,
      );
    }
    if (workflow.includes("sudo apt-get update")) {
      failures.push(`${name} must not retain unbounded sudo apt-get update commands`);
    }
  }
}

function checkLinuxReleaseWorkflow() {
  requireBooleanInputDefault(linuxRelease, "docker_smoke", false, "release-linux.yml");
  requireBooleanInputDefault(linuxRelease, "build_arm64", true, "release-linux.yml");

  if (!hasYamlKeyLine(linuxRelease, "push") || !linuxRelease.includes('tags: ["v*"]')) {
    failures.push("release-linux.yml must build automatically for v* tags");
  }
  if (!linuxRelease.includes("inputs.build_arm64")) {
    failures.push("release-linux.yml must require build_arm64 on dispatch");
  }
  if (!linuxRelease.includes("ubuntu-22.04-arm")) {
    failures.push("release-linux.yml must keep the free public arm64 runner explicit when enabled");
  }
  if (!linuxRelease.includes("inputs.docker_smoke")) {
    failures.push("release-linux.yml Docker smoke must be gated by docker_smoke input");
  }
  for (const marker of [
    "fetch-depth: 0",
    "github.event_name == 'push'",
    "github.ref_name",
    "verify-release-tag.mjs",
    "IMGCONVERT_RELEASE_TAG",
  ]) {
    if (!linuxRelease.includes(marker)) {
      failures.push(`release-linux.yml must verify pushed release tags: ${marker}`);
    }
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
  for (const marker of ["fetch-depth: 0", "verify-release-tag.mjs", "IMGCONVERT_RELEASE_TAG"]) {
    if (!updaterRelease.includes(marker)) {
      failures.push(`release-updater.yml must verify its immutable release tag: ${marker}`);
    }
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

function checkSnapStoreReleaseWorkflow() {
  requireBooleanInputDefault(snapStoreRelease, "build_arm64", true, "snap-store-release.yml");
  requireBooleanInputDefault(snapStoreRelease, "publish_snap", false, "snap-store-release.yml");
  for (const marker of [
    "ref: ${{ inputs.tag }}",
    "fetch-depth: 0",
    "verify-release-tag.mjs",
    "snapcore/action-build@3bdaa03e1ba6bf59a65f84a751d943d549a54e79",
    "snapcore/action-publish@214b86e5ca036ead1668c79afb81e550e6c54d40",
    "SNAP_STORE_LOGIN",
    "inputs.publish_snap",
    "retention-days: 7",
  ]) {
    if (!snapStoreRelease.includes(marker)) {
      failures.push(`snap-store-release.yml missing marker: ${marker}`);
    }
  }
  if (!snapStoreRelease.includes("ubuntu-24.04-arm")) {
    failures.push("snap-store-release.yml must keep the free public arm64 runner explicit");
  }
}

function checkStandardPlatformWorkflow(name, text, label, runner) {
  if (!text.includes(`runs-on: ${runner}`)) {
    failures.push(`${name} must keep ${label} standard runner explicit`);
  }
}

function checkMacosSmokeWorkflow() {
  for (const marker of [
    "actions: read",
    "retry_signed_dmg_run_id",
    "inputs.retry_signed_dmg_run_id == ''",
    "inputs.retry_signed_dmg_run_id != ''",
    "Retry saved signed DMG submission",
    "timeout-minutes: 15",
    "source run must have failed",
    "retry must run from the default branch",
    "source run must contain exactly one live pending DMG artifact",
    "source run already contains a notarization receipt",
    "imgconvert-macos-arm64-dmg-pending",
    "imgconvert-macos-notarization-receipt",
  ]) {
    if (!macosSmoke.includes(marker)) {
      failures.push(`macos-smoke.yml missing bounded notarization retry marker: ${marker}`);
    }
  }
}

function checkMacosDmgReleaseWorkflow() {
  requireStringInput(macosRelease, "tag", "macos-release.yml");
  requireBooleanInputDefault(macosRelease, "publish_release", false, "macos-release.yml");

  for (const marker of [
    "contents: read",
    "ref: ${{ inputs.tag }}",
    "fetch-depth: 0",
    "verify-release-tag.mjs",
    "IMGCONVERT_RELEASE_TAG",
    "APPLE_DIRECT_CERTIFICATE",
    "release:macos:notarize",
    "--submit-only",
    "notarization.json",
    "runner: macos-15",
    "runner: macos-15-intel",
    "nasm-2.16.03-macosx.zip",
    "0d29bcd8a5fc617333f4549c7c1f93d1866a4a0915c40359e0a8585bb1a5aa75",
    "imgconvert-macos-${{ matrix.arch }}-dmg-pending",
    "imgconvert-macos-${{ matrix.arch }}-notarization-receipt",
    "retention-days: 7",
    "inputs.publish_release",
  ]) {
    if (!macosRelease.includes(marker)) {
      failures.push(`macos-release.yml missing signed/notarized publication marker: ${marker}`);
    }
  }
  if (/^\s+draft:\s*/m.test(macosRelease)) {
    failures.push("macos-release.yml must not create or change a GitHub Release draft state");
  }
  if (macosRelease.includes("gh release upload")) {
    failures.push("macos-release.yml must defer release attachment to the notarization finalizer");
  }
}

function checkMacosMasReleaseWorkflow() {
  requireStringInput(macosMasRelease, "tag", "macos-mas-release.yml");
  requireBooleanInputDefault(macosMasRelease, "upload_build", false, "macos-mas-release.yml");

  for (const marker of [
    "contents: read",
    "ref: ${{ inputs.tag }}",
    "fetch-depth: 0",
    "verify-release-tag.mjs",
    "release tag must point to a commit on the default branch",
    'IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1"',
    'IMGCONVERT_DISABLE_UPDATER: "1"',
    "APPLE_MAS_CERTIFICATE",
    "APPLE_MAS_INSTALLER_CERTIFICATE",
    "IMGCONVERT_MAS_PROVISION_PROFILE_BASE64",
    "release:macos:mas:submit",
    "inputs.upload_build",
    "retention-days: 14",
  ]) {
    if (!macosMasRelease.includes(marker)) {
      failures.push(`macos-mas-release.yml missing release marker: ${marker}`);
    }
  }
}

function checkMacosNotarizationFinalizeWorkflow() {
  requireStringInput(macosNotarizationFinalize, "source_run_id", "macos-notarization-finalize.yml");
  for (const marker of [
    "actions: read",
    "contents: write",
    "timeout-minutes: 15",
    "Validate source workflow run",
    "macos-smoke.yml",
    "macos-release.yml",
    "source run must use the default branch",
    "finalizer must run from the default branch",
    "gh run download",
    "architecture:",
    "imgconvert-macos-${IMGCONVERT_DMG_ARCH}-dmg-pending",
    "imgconvert-macos-${IMGCONVERT_DMG_ARCH}-notarization-receipt",
    "--finalize",
    "notarization_status == 'Accepted'",
    "imgconvert-macos-${{ inputs.architecture }}-dmg-notarized",
    "gh release view",
    "gh release upload",
  ]) {
    if (!macosNotarizationFinalize.includes(marker)) {
      failures.push(`macos-notarization-finalize.yml missing marker: ${marker}`);
    }
  }
  if (macosNotarizationFinalize.includes("ref: ${{ steps.source.outputs.head_sha }}")) {
    failures.push("macOS notarization finalizer must not execute code from the source build run");
  }
  if (macosNotarizationFinalize.includes("git checkout --detach")) {
    failures.push("macOS notarization finalizer must not execute code from a release tag");
  }
  if (macosNotarizationFinalize.includes("APPLE_API_KEY_PATH=$key_path")) {
    failures.push("macOS notarization finalizer must not persist the API key path job-wide");
  }
}

function checkWindowsStoreReleaseWorkflow() {
  requireStringInput(windowsStoreRelease, "release_tag", "windows-store-release.yml");
  for (const marker of [
    "ref: ${{ inputs.release_tag }}",
    "fetch-depth: 0",
    "verify-release-tag.mjs",
    "IMGCONVERT_RELEASE_TAG",
    "release:windows:msix",
    "release:windows:msix:smoke",
    'IMGCONVERT_DISABLE_EXTERNAL_CODECS: "1"',
    'IMGCONVERT_DISABLE_UPDATER: "1"',
    "runner: windows-latest",
    "runner: windows-11-arm",
    "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
    'python-version: "3.12.10"',
    "nasm-2.16.03-win64.zip",
    "3ee4782247bcb874378d02f7eab4e294a84d3d15f3f6ee2de2f47a46aa7226e6",
    '$cc = "clang-cl"',
    "CC=$cc CXX=$cxx",
    "CFLAGS_aarch64_pc_windows_msvc=$arm64CFlags",
    "-DHAVE_INTRIN_H=1",
    "aarch64-.*-windows-msvc",
    "Verify ARM64-aware Store packaging source",
    "imgconvert-windows-${{ matrix.arch }}-msix-submission",
  ]) {
    if (!windowsStoreRelease.includes(marker)) {
      failures.push(`windows-store-release.yml missing marker: ${marker}`);
    }
  }
}

function checkWindowsSmokeWorkflow() {
  for (const marker of [
    "type: choice",
    "- msi,nsis",
    "- msi",
    "- nsis",
    "SMOKE_BUNDLES: ${{ inputs.bundles }}",
    "SMOKE_SIGN_DIRECT: ${{ inputs.sign_direct }}",
    "SMOKE_INSTALL_SMOKE: ${{ inputs.install_smoke }}",
    "$env:SMOKE_BUNDLES -notin $allowedBundles",
    "WINDOWS_CERTIFICATE_BASE64: ${{ secrets.WINDOWS_CERTIFICATE_BASE64 }}",
    "WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}",
    "WINDOWS_CERTIFICATE_SHA1: ${{ secrets.WINDOWS_CERTIFICATE_SHA1 }}",
    "$env:WINDOWS_CERTIFICATE_BASE64",
    "$env:WINDOWS_CERTIFICATE_PASSWORD",
    "$env:WINDOWS_CERTIFICATE_SHA1",
  ]) {
    if (!windowsSmoke.includes(marker)) {
      failures.push(`windows-smoke.yml missing safe direct-build marker: ${marker}`);
    }
  }

  for (const forbidden of [
    '"${{ secrets.WINDOWS_CERTIFICATE_BASE64 }}"',
    '"${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}"',
    '"${{ secrets.WINDOWS_CERTIFICATE_SHA1 }}"',
    '"--bundles=${{ inputs.bundles }}"',
    '"${{ inputs.sign_direct }}"',
    '"${{ inputs.install_smoke }}"',
  ]) {
    if (windowsSmoke.includes(forbidden)) {
      failures.push(`windows-smoke.yml must not interpolate ${forbidden} into PowerShell`);
    }
  }

  for (const marker of [
    "IMGCONVERT_UPDATER_REPOSITORY: ${{ github.repository }}",
    "IMGCONVERT_UPDATER_FROM_TAG: ${{ inputs.from_tag }}",
    "IMGCONVERT_UPDATER_TO_TAG: ${{ inputs.to_tag }}",
    '--repo="$IMGCONVERT_UPDATER_REPOSITORY"',
    '--from-tag="$IMGCONVERT_UPDATER_FROM_TAG"',
    '--to-tag="$IMGCONVERT_UPDATER_TO_TAG"',
  ]) {
    if (!updaterUpgradeSmoke.includes(marker)) {
      failures.push(`updater-upgrade-smoke.yml missing safe input marker: ${marker}`);
    }
  }
  for (const forbidden of [
    '--repo="${{ github.repository }}"',
    '--from-tag="${{ inputs.from_tag }}"',
    '--to-tag="${{ inputs.to_tag }}"',
  ]) {
    if (updaterUpgradeSmoke.includes(forbidden)) {
      failures.push(`updater-upgrade-smoke.yml must not interpolate ${forbidden} into shell`);
    }
  }
}

function checkSnapStoreMetadataWorkflow() {
  if (!snapStoreMetadata.includes("scripts/ci-install-apt-packages.sh python3-pymacaroons")) {
    failures.push("snap-store-metadata.yml must use the bounded Ubuntu dependency bootstrap");
  }
  if (snapStoreMetadata.includes("sudo apt-get update")) {
    failures.push("snap-store-metadata.yml must not retain an unbounded sudo apt-get update");
  }
}

function checkPagesWorkflow() {
  for (const marker of [
    "github.event.repository.has_pages == true",
    "actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b",
    "actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b",
    "actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
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

function requireStringInput(text, inputName, workflowName) {
  const inputBlock = text.match(
    new RegExp(`\\n\\s{6}${escapeRegExp(inputName)}:\\n(?<body>(?:\\s{8}.+\\n)+)`),
  );
  if (!inputBlock?.groups?.body) {
    failures.push(`${workflowName} must define workflow_dispatch input ${inputName}`);
    return;
  }
  if (!/\n\s{8}required:\s*true\b/.test(inputBlock.groups.body)) {
    failures.push(`${workflowName} input ${inputName} must be required`);
  }
  if (!/\n\s{8}type:\s*string\b/.test(inputBlock.groups.body)) {
    failures.push(`${workflowName} input ${inputName} must be string`);
  }
  if (/\n\s{8}default\s*:/.test(inputBlock.groups.body)) {
    failures.push(`${workflowName} input ${inputName} must not default to a mutable ref`);
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
