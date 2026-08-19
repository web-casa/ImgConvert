// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const privacyPage = readRequired("pages/privacy/index.html");
const landingPage = readRequired("pages/index.html");
const notFoundPage = readRequired("pages/404.html");
const styles = readRequired("pages/assets/privacy.css");
const chinesePolicy = readRequired("PRIVACY.md");
const englishPolicy = readRequired("PRIVACY.en.md");
const workflow = readRequired(".github/workflows/pages.yml");

for (const [label, text, required] of [
  ["privacy page", privacyPage, 'id="en"'],
  ["privacy page", privacyPage, 'id="zh-CN"'],
  ["privacy page", privacyPage, 'lang="en"'],
  ["privacy page", privacyPage, 'lang="zh-CN"'],
  ["privacy page", privacyPage, "Effective date: 19 August 2026"],
  ["privacy page", privacyPage, "custom output directory"],
  ["privacy page", privacyPage, "自定义输出目录"],
  ["privacy page", privacyPage, "ImgConvert 不输出 HEIC 文件"],
  ["privacy page", privacyPage, "https://github.com/web-casa/ImgConvert/issues"],
  ["landing page", landingPage, "url=privacy/"],
  ["Chinese policy", chinesePolicy, "生效日期：2026-08-19"],
  ["Chinese policy", chinesePolicy, "不会上传、收集或向第三方传输以下信息"],
  ["Chinese policy", chinesePolicy, "自定义输出目录或 HEIC helper"],
  ["English policy", englishPolicy, "Effective date: August 19, 2026"],
  [
    "English policy",
    englishPolicy,
    "does not upload, collect, or transmit the following information",
  ],
  ["English policy", englishPolicy, "custom output directory or a HEIC helper"],
  ["Pages workflow", workflow, "workflow_dispatch:"],
  ["Pages workflow", workflow, "runs-on: ubuntu-24.04"],
  ["Pages workflow", workflow, "actions/configure-pages@v5"],
  ["Pages workflow", workflow, "actions/upload-pages-artifact@v4"],
  ["Pages workflow", workflow, "actions/deploy-pages@v4"],
  ["Pages workflow", workflow, "github.event.repository.has_pages == true"],
  ["Pages workflow", workflow, "path: pages"],
  ["Pages workflow", workflow, "pages: write"],
  ["Pages workflow", workflow, "id-token: write"],
]) {
  if (!normalizeWhitespace(text).includes(normalizeWhitespace(required))) {
    failures.push(`${label} missing required content: ${required}`);
  }
}

for (const [label, page] of [
  ["privacy page", privacyPage],
  ["landing page", landingPage],
  ["404 page", notFoundPage],
]) {
  if (
    /<(?:img|script|iframe|embed|object|audio|video|source|track)\b[^>]+\bsrc=["'](?:https?:)?\/\//i.test(
      page,
    )
  ) {
    failures.push(`${label} must not load remote media, script, or embedded resources`);
  }
  if (/<link\b[^>]+\bhref=["'](?:https?:)?\/\//i.test(page)) {
    failures.push(`${label} must not load remote stylesheet resources`);
  }
}
if (/@import\s+url\s*\(\s*["']?(?:https?:)?\/\//i.test(styles)) {
  failures.push("privacy stylesheet must not import remote resources");
}
if (/url\s*\(\s*["']?(?:https?:)?\/\//i.test(styles)) {
  failures.push("privacy stylesheet must not load remote resources");
}
if (/runs-on:\s*[^\n#]*(?:large|xlarge|gpu|64core|32core|16core)/i.test(workflow)) {
  failures.push("Pages workflow must use only a standard public GitHub Actions runner");
}
if (
  workflow.includes("IMGCONVERT_DISABLE_EXTERNAL_CODECS") ||
  workflow.includes("IMGCONVERT_DISABLE_UPDATER")
) {
  failures.push("Pages workflow must not alter Store codec or updater build configuration");
}

if (failures.length > 0) {
  console.error("Pages privacy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Pages privacy check passed.");

function readRequired(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`missing required file: ${relativePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}
