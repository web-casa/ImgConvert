// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const englishPages = ["index", "install", "usage", "privacy", "troubleshooting"];

const i18n = readRequired("docs-site/lib/i18n.ts");
const localeRouting = readRequired("docs-site/lib/locale-routing.ts");
const source = readRequired("docs-site/lib/source.ts");
const proxy = readRequired("docs-site/proxy.ts");
const rootLayout = readRequired("docs-site/app/[lang]/layout.tsx");
const docsLayout = readRequired("docs-site/app/[lang]/docs/layout.tsx");
const docsPage = readRequired("docs-site/app/[lang]/docs/[[...slug]]/page.tsx");
const homePage = readRequired("docs-site/app/[lang]/page.tsx");
const docsNotFound = readRequired("docs-site/app/[lang]/docs/[[...slug]]/not-found.tsx");
const localeCatchAll = readRequired("docs-site/app/[lang]/[...slug]/page.tsx");
const docsProvider = readRequired("docs-site/components/docs-provider.tsx");
const localeLink = readRequired("docs-site/components/locale-link.tsx");
const staticPolicy = readRequired("pages/privacy/index.html");
const rootPackage = JSON.parse(readRequired("package.json"));
const chineseMeta = readJsonRequired("docs-site/content/docs/meta.json");
const englishMeta = readJsonRequired("docs-site/content/docs/meta.en-US.json");

for (const [label, text, required] of [
  ["i18n configuration", i18n, "defaultLanguage: defaultDocsLocale"],
  ["i18n configuration", i18n, "fallbackLanguage: null"],
  ["i18n configuration", i18n, 'hideLocale: "default-locale"'],
  ["i18n configuration", i18n, '"zh-CN"'],
  ["i18n configuration", i18n, '"en-US"'],
  ["content source", source, "i18n,"],
  ["locale proxy", proxy, "createI18nMiddleware(i18n)"],
  ["locale proxy", proxy, "?!api|_next/static|_next/image|favicon.ico|app-icon.png"],
  ["localized root layout", rootLayout, "<html lang={locale}"],
  ["localized docs layout", docsLayout, "source.getPageTree(locale)"],
  ["localized docs page", docsPage, "source.getPage(params.slug, locale)"],
  ["localized docs page", docsPage, "source.generateParams()"],
  ["localized docs page", docsPage, "findNeighbour(source.getPageTree(locale), page.url)"],
  ["localized docs not-found boundary", docsNotFound, "<DocsNotFound />"],
  ["localized unknown route", localeCatchAll, "notFound();"],
  ["localized home page", homePage, "homeData[locale]"],
  ["locale switcher", localeLink, 'getLocalePath(pathname ?? "/", targetLocale)'],
  ["locale routing", localeRouting, 'return localePath(targetLocale, "/docs")'],
  ["locale routing", localeRouting, "export function frameworkPathname"],
  ["locale routing", localeRouting, "!normalizedPath.startsWith(`${hiddenDefaultPrefix}/`)"],
  ["docs framework provider", rootLayout, "<DocsProvider locale={locale}>"],
  ["docs framework provider", docsProvider, "FrameworkProvider"],
  ["docs framework provider", docsProvider, "frameworkPathname(locale, pathname)"],
  ["canonical policy title", docsPage, "isCanonicalPolicyPage(page.path)"],
  ["canonical policy title", docsPage, 'path === "privacy.en-US.mdx"'],
  ["static privacy page", staticPolicy, "result-cache records"],
  ["static privacy page", staticPolicy, "结果缓存记录"],
]) {
  if (!text.includes(required)) {
    failures.push(`${label} missing required content: ${required}`);
  }
}

if (!arraysEqual(englishMeta?.pages, englishPages)) {
  failures.push(`English documentation navigation must be exactly: ${englishPages.join(", ")}`);
}

if (!Array.isArray(chineseMeta?.pages) || !chineseMeta.pages.includes("privacy")) {
  failures.push("Chinese documentation navigation must include the privacy policy");
}

for (const page of englishPages) {
  const englishPath = `docs-site/content/docs/${page}.en-US.mdx`;
  const chinesePath = `docs-site/content/docs/${page}.mdx`;
  const english = readRequired(englishPath);
  readRequired(chinesePath);

  if (!/^---\r?\ntitle:\s*.+\r?\n[\s\S]*?\r?\n---\r?\n/.test(english)) {
    failures.push(`${englishPath} must declare a title frontmatter field`);
  }
}

assertCanonicalPolicyInclude("docs-site/content/docs/privacy.mdx", "../PRIVACY.md");
assertCanonicalPolicyInclude("docs-site/content/docs/privacy.en-US.mdx", "../PRIVACY.en.md");

const scripts = rootPackage.scripts ?? {};
if (!scripts["docs:web:check"]?.includes("check-docs-site-i18n.mjs")) {
  failures.push("docs:web:check must run the docs-site i18n check");
}
if (!scripts["docs:check"]?.includes("check-docs-site-i18n.mjs")) {
  failures.push("docs:check must run the docs-site i18n check");
}
if (!scripts["quality:frontend"]?.includes("docs:web:check")) {
  failures.push("quality:frontend must compile and check the docs-site");
}

if (failures.length > 0) {
  console.error("Docs-site i18n check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Docs-site i18n check passed.");

function assertCanonicalPolicyInclude(relativePath, expectedPath) {
  const content = readRequired(relativePath);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  const expected = `<include cwd>${expectedPath}</include>`;

  if (body !== expected) {
    failures.push(`${relativePath} must only include its canonical root policy source`);
  }
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function readJsonRequired(relativePath) {
  const text = readRequired(relativePath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    failures.push(`invalid JSON: ${relativePath}`);
    return null;
  }
}

function readRequired(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`missing required file: ${relativePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}
