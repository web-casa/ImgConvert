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
const chinesePolicyDate = requiredMatch(
  chinesePolicy,
  /生效日期：(\d{4}-\d{2}-\d{2})/,
  "Chinese policy effective date",
);
const englishPolicyDate = requiredMatch(
  englishPolicy,
  /Effective date: ([A-Z][a-z]+ \d{1,2}, \d{4})/,
  "English policy effective date",
);
const privacyPageDate = requiredMatch(
  privacyPage,
  /<time\s+datetime="(\d{4}-\d{2}-\d{2})">/,
  "privacy page effective date",
);

for (const [label, text, required] of [
  ["privacy page", privacyPage, 'id="en"'],
  ["privacy page", privacyPage, 'id="zh-CN"'],
  ["privacy page", privacyPage, 'lang="en"'],
  ["privacy page", privacyPage, 'lang="zh-CN"'],
  ["privacy page", privacyPage, "custom output directory"],
  ["privacy page", privacyPage, "result-cache records"],
  ["privacy page", privacyPage, "you can disable result reuse in the app"],
  ["privacy page", privacyPage, "自定义输出目录"],
  ["privacy page", privacyPage, "结果缓存记录"],
  ["privacy page", privacyPage, "你可以在应用中关闭结果复用"],
  ["privacy page", privacyPage, "ImgConvert 不输出 HEIC 文件"],
  ["privacy page", privacyPage, "https://github.com/web-casa/ImgConvert/issues"],
  ["landing page", landingPage, "url=privacy/"],
  ["Chinese policy", chinesePolicy, "不会上传、收集或向第三方传输以下信息"],
  ["Chinese policy", chinesePolicy, "自定义输出目录或 HEIC helper"],
  ["Chinese policy", chinesePolicy, "结果缓存记录只包含用于校验或复用转换结果的哈希值和文件大小"],
  ["Chinese policy", chinesePolicy, "你可以在应用中关闭结果复用"],
  [
    "English policy",
    englishPolicy,
    "does not upload, collect, or transmit the following information",
  ],
  ["English policy", englishPolicy, "custom output directory or a HEIC helper"],
  ["English policy", englishPolicy, "Result-cache records contain only hashes and file sizes"],
  ["English policy", englishPolicy, "you can disable result reuse in the app"],
  ["Pages workflow", workflow, "workflow_dispatch:"],
  ["Pages workflow", workflow, "runs-on: ubuntu-24.04"],
  ["Pages workflow", workflow, "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d"],
  [
    "Pages workflow",
    workflow,
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  ],
  ["Pages workflow", workflow, "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"],
  ["Pages workflow", workflow, "github.event.repository.has_pages == true"],
  ["Pages workflow", workflow, "path: pages"],
  ["Pages workflow", workflow, "pages: write"],
  ["Pages workflow", workflow, "id-token: write"],
]) {
  if (!normalizeWhitespace(text).includes(normalizeWhitespace(required))) {
    failures.push(`${label} missing required content: ${required}`);
  }
}

if (chinesePolicyDate) {
  const expectedEnglishDate = formatPolicyDate(chinesePolicyDate, "en-US");
  const expectedPrivacyPageDate = formatPolicyDate(chinesePolicyDate, "en-GB");
  if (englishPolicyDate !== expectedEnglishDate) {
    failures.push(
      `English policy effective date must match Chinese policy date: ${expectedEnglishDate}`,
    );
  }
  if (privacyPageDate !== chinesePolicyDate) {
    failures.push("privacy page datetime must match the Chinese policy effective date");
  }
  if (!normalizeWhitespace(privacyPage).includes(`Effective date: ${expectedPrivacyPageDate}`)) {
    failures.push("privacy page visible effective date must match the policy effective date");
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
  const csp = cspMeta(page);
  if (!csp) {
    failures.push(`${label} must declare a Content Security Policy meta tag`);
  } else {
    for (const directive of [
      "default-src 'self'",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      if (!csp.includes(directive)) {
        failures.push(`${label} CSP missing directive: ${directive}`);
      }
    }
  }
  if (
    !/<meta\b(?=[^>]*\bname=["']referrer["'])(?=[^>]*\bcontent=["']no-referrer["'])[^>]*>/i.test(
      page,
    )
  ) {
    failures.push(`${label} must use a no-referrer policy`);
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

function requiredMatch(text, expression, label) {
  const match = text.match(expression);
  if (!match?.[1]) {
    failures.push(`${label} is missing or invalid`);
    return null;
  }
  return match[1];
}

function formatPolicyDate(isoDate, locale) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function cspMeta(page) {
  const tag = page.match(
    /<meta\b(?=[^>]*\bhttp-equiv=["']Content-Security-Policy["'])[^>]*>/i,
  )?.[0];
  return tag ? normalizeWhitespace(tag) : null;
}
