// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

function argumentValue(name) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

const baseUrl = new URL(argumentValue("--base-url") ?? "https://imgconvert.web.casa");
const environment = argumentValue("--environment") ?? "production";
const deploymentId = argumentValue("--deployment-id");
const reportArgument = argumentValue("--report") ?? ".output/reports/privacy-production.json";
const reportPath = resolve(projectRoot, reportArgument);
const reportsRoot = resolve(projectRoot, ".output", "reports");
const executablePath = process.env.IMGCONVERT_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium";

if (baseUrl.protocol !== "https:" || baseUrl.pathname !== "/") {
  throw new Error("Privacy base URL must be an HTTPS origin without a path");
}
if (!new Set(["preview", "production"]).has(environment)) {
  throw new Error("Privacy environment must be preview or production");
}
if (environment === "production" && baseUrl.origin !== "https://imgconvert.web.casa") {
  throw new Error("Production privacy verification must use https://imgconvert.web.casa");
}
if (!deploymentId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(deploymentId)) {
  throw new Error("A full Cloudflare deployment ID is required");
}
if (reportPath !== reportsRoot && !reportPath.startsWith(`${reportsRoot}/`)) {
  throw new Error("Privacy reports must be written below browser-extension/.output/reports");
}

const definitions = [
  {
    locale: "zh-CN",
    path: "/privacy/",
    phrases: ["Chrome 与 Edge 浏览器扩展", "最长两分钟", "拒绝权限不会发出图片请求"],
  },
  {
    locale: "en",
    path: "/en/privacy/",
    phrases: [
      "Chrome and Edge browser extensions",
      "expires after at most two minutes",
      "Denying access sends no image request",
    ],
  },
];
const pages = [];
const pageFailures = [];
let browser;
let context;
let failure;
let browserVersion;
try {
  const identity = await execFileAsync(executablePath, ["--version"]);
  browserVersion = `${identity.stdout}${identity.stderr}`.trim();
  browser = await chromium.launch({ executablePath, headless: true });
  context = await browser.newContext();
  for (const definition of definitions) {
    const url = new URL(definition.path, baseUrl);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const html = await response.text();
    const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
    const referrerPolicy = response.headers.get("referrer-policy") ?? "";
    const xContentTypeOptions = response.headers.get("x-content-type-options") ?? "";
    const securityHeadersVerified =
      contentSecurityPolicy.includes("default-src 'self'") &&
      contentSecurityPolicy.includes("frame-ancestors 'none'") &&
      xContentTypeOptions === "nosniff" &&
      referrerPolicy === "strict-origin-when-cross-origin";
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.locator("h1").waitFor({ state: "visible" });
    const visibleText = await page.locator("body").innerText();
    await page.close();
    const contentVerified = definition.phrases.every((phrase) => visibleText.includes(phrase));
    pages.push({
      contentVerified,
      headers: { contentSecurityPolicy, referrerPolicy, xContentTypeOptions },
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      https: url.protocol === "https:",
      locale: definition.locale,
      securityHeadersVerified,
      status: response.status,
      url: url.href,
    });
    if (response.status !== 200 || !contentVerified || !securityHeadersVerified) {
      pageFailures.push(
        `${definition.locale} privacy page failed status, content, or header checks`,
      );
    }
  }
  if (pageFailures.length > 0) throw new Error(pageFailures.join("; "));
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await context?.close();
  await browser?.close();
}

const report = {
  baseUrl: baseUrl.origin,
  browser: { executablePath, version: browserVersion },
  deploymentId,
  environment,
  failure,
  generatedAt: new Date().toISOString(),
  pages,
  passed: failure === undefined && pages.length === definitions.length,
  schemaVersion: 2,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!report.passed) throw new Error(`Privacy deployment verification failed: ${failure}`);
console.log(`Verified ${environment} privacy deployment at ${baseUrl.origin} (${reportPath})`);
