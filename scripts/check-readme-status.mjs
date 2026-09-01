// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRequiredJson } from "./read-required-json.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const readme = readText("README.md");
const readmeZhCn = readText("README.zh-CN.md");
const roadmap = readText("docs/ROADMAP.md");
const publicRelease = readRequiredJson(repoRoot, "docs/public-release.json", failures);
const packageJson = readRequiredJson(repoRoot, "package.json", failures);
const tauriConfig = readRequiredJson(repoRoot, "src-tauri/tauri.conf.json", failures);
const tauriCargo = readText("src-tauri/Cargo.toml");

checkReadmeIsCurrent();
checkReadmeDocumentsReleaseEntrypoints();
checkPackageWiring();

if (failures.length > 0) {
  console.error("README status check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("README status check passed.");

function checkReadmeIsCurrent() {
  const publicVersion =
    typeof publicRelease.version === "string" ? publicRelease.version.trim() : "";
  const hasValidPublicVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(publicVersion);
  if (!hasValidPublicVersion) {
    failures.push("docs/public-release.json must contain a valid published version");
  }
  if (publicRelease.published !== true) {
    failures.push("docs/public-release.json must explicitly mark the release as published");
  }
  if (hasValidPublicVersion) {
    if (!existsSync(path.join(repoRoot, `docs/RELEASE_V${publicVersion}.md`))) {
      failures.push(`missing release record for public version v${publicVersion}`);
    }
    const expectedRelease = `v${publicVersion}`;
    checkDeclaredReleaseVersion(
      "English README",
      readme,
      /latest GitHub Release is \*\*(v[^*]+)\*\*/,
      expectedRelease,
    );
    checkDeclaredReleaseVersion(
      "Chinese README",
      readmeZhCn,
      /最新 GitHub Release 为 \*\*(v[^*]+)\*\*/,
      expectedRelease,
    );
  }

  for (const staleText of [
    "当前为前端串行",
    "P1 改为 Rust 端并发",
    "Release MVP",
    "尚未开始",
    "HEIC:Linux v1 不含;macOS/Windows 后续走系统原生能力",
    "并发批量 + 进度/取消(Rust 端,Channel 上报)",
    "高级压缩(自动质量、多候选取最小、ICC/EXIF 保真)",
  ]) {
    if (readmeZhCn.includes(staleText)) {
      failures.push(`Chinese README still contains stale status text: ${staleText}`);
    }
  }

  for (const expected of [
    "Rust batch conversion",
    "skip-if-larger",
    "true lossless AVIF",
    "color pipeline v2",
    "Tauri updater",
    "Real release validation",
    "External validation",
    "real-image corpus",
    "Windows benchmark",
  ]) {
    if (!readme.includes(expected)) {
      failures.push(`English README must describe current project status marker: ${expected}`);
    }
  }

  for (const expected of [
    "Rust 端批量转换",
    "skip-if-larger",
    "AVIF 真无损",
    "色彩管线 v2",
    "Tauri updater",
    "真实发布验收",
    "外部验收",
    "真实图片 corpus",
    "Windows benchmark",
  ]) {
    if (!readmeZhCn.includes(expected)) {
      failures.push(`Chinese README must describe current project status marker: ${expected}`);
    }
  }

  if (!readme.includes('href="README.zh-CN.md"')) {
    failures.push("English README must link to README.zh-CN.md");
  }
  if (!readmeZhCn.includes('href="README.md"')) {
    failures.push("Chinese README must link back to README.md");
  }
}

function checkReadmeDocumentsReleaseEntrypoints() {
  for (const expected of [
    "pnpm run release:readiness",
    "pnpm run release:readiness:github:ready",
    "pnpm run release:platform:check",
    "docs/ROADMAP.md",
    "docs/ENGINE.md",
    "docs/LEGAL.md",
  ]) {
    for (const [label, content] of [
      ["English README", readme],
      ["Chinese README", readmeZhCn],
    ]) {
      if (!content.includes(expected)) {
        failures.push(`${label} must document release/status entrypoint: ${expected}`);
      }
    }
  }

  if (!roadmap.includes("发布 readiness 报告")) {
    failures.push("ROADMAP must keep the release readiness status documented");
  }
}

function checkPackageWiring() {
  const scripts = packageJson.scripts ?? {};
  if (tauriConfig.version !== packageJson.version) {
    failures.push(
      `Tauri config version ${tauriConfig.version ?? "<missing>"} must match package version ${packageJson.version}`,
    );
  }
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(tauriCargo)?.[1];
  if (cargoVersion !== packageJson.version) {
    failures.push(
      `Tauri Cargo version ${cargoVersion ?? "<missing>"} must match package version ${packageJson.version}`,
    );
  }
  if (!scripts["docs:check"]?.includes("check-readme-status.mjs")) {
    failures.push("package.json must expose docs:check");
  }
  if (!scripts["release:platform:check"]?.includes("release:readiness:check")) {
    failures.push("release:platform:check must run release:readiness:check");
  }
  if (!scripts["release:readiness:check"]?.includes("docs:check")) {
    failures.push("package.json must expose release:readiness:check with README guardrails");
  }
}

function checkDeclaredReleaseVersion(label, content, pattern, expected) {
  const declared = pattern.exec(content)?.[1];
  if (declared !== expected) {
    failures.push(
      `${label} latest public release ${declared ?? "<missing>"} must match current release ${expected}`,
    );
  }
  if (!content.includes(`GitHub Release ${expected}`)) {
    failures.push(`${label} release status section must describe GitHub Release ${expected}`);
  }
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}
