// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://imgconvert.web.casa";
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const REQUIRED_ROUTES = [
  "/",
  "/en/",
  "/environment/",
  "/en/environment/",
  "/privacy/",
  "/en/privacy/",
  "/legal/",
  "/en/legal/",
  "/docs/",
  "/en/docs/",
  "/blog/",
  "/en/blog/",
  "/windows/png-to-avif/",
  "/en/windows/png-to-avif/",
  "/macos/heic-to-jpg/",
  "/en/macos/heic-to-jpg/",
  "/ubuntu/webp-lossless-compression/",
  "/en/ubuntu/webp-lossless-compression/",
  "/linux/jpeg-to-avif/",
  "/en/linux/jpeg-to-avif/",
  "/convert/",
];
const REQUIRED_CONTENT_ROUTES = [
  "/environment/",
  "/en/environment/",
  "/privacy/",
  "/en/privacy/",
  "/legal/",
  "/en/legal/",
  "/docs/",
  "/en/docs/",
  "/blog/",
  "/en/blog/",
];

function invariant(condition, message) {
  if (!condition) throw new Error(`Web release check failed: ${message}`);
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..")
  );
}

async function readText(pathname, label) {
  const stats = await lstat(pathname);
  invariant(stats.isFile() && !stats.isSymbolicLink(), `${label} must be a regular file`);
  invariant(stats.size <= MAX_TEXT_FILE_BYTES, `${label} exceeds ${MAX_TEXT_FILE_BYTES} bytes`);
  return readFile(pathname, "utf8");
}

async function assertRegularFile(pathname, label) {
  const stats = await lstat(pathname);
  invariant(stats.isFile() && !stats.isSymbolicLink(), `${label} must be a regular file`);
  return stats;
}

async function listFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const pathname = resolve(directory, entry.name);
      invariant(isWithin(root, pathname), `path escaped release root: ${pathname}`);
      const stats = await lstat(pathname);
      invariant(
        !stats.isSymbolicLink(),
        `release contains a symbolic link: ${relative(root, pathname)}`,
      );
      if (stats.isDirectory()) {
        await visit(pathname);
      } else {
        invariant(
          stats.isFile(),
          `release contains a non-regular file: ${relative(root, pathname)}`,
        );
        files.push(pathname);
      }
    }
  }

  await visit(root);
  return files;
}

function routeFile(distributionRoot, route) {
  const url = new URL(route, SITE_ORIGIN);
  invariant(url.origin === SITE_ORIGIN, `route is not same-origin: ${route}`);
  const decodedPath = decodeURIComponent(url.pathname);
  invariant(!decodedPath.split("/").includes(".."), `route contains traversal: ${route}`);
  const pathname = resolve(distributionRoot, `.${decodedPath}`, "index.html");
  invariant(isWithin(distributionRoot, pathname), `route escaped website/dist: ${route}`);
  return pathname;
}

function parseHeaderRules(source) {
  const rules = new Map();
  let activeRule;

  for (const rawLine of source.split(/\r?\n/u)) {
    if (!rawLine.trim()) continue;
    if (!/^\s/u.test(rawLine)) {
      activeRule = rawLine.trim();
      rules.set(activeRule, []);
      continue;
    }
    invariant(activeRule, "_headers contains a directive before a route pattern");
    rules.get(activeRule).push(rawLine.trim());
  }

  return rules;
}

function includesDirective(directives, expected) {
  return directives.some((directive) => directive.toLowerCase() === expected.toLowerCase());
}

function assertHeaders(source) {
  const rules = parseHeaderRules(source);
  const globalHeaders = rules.get("/*") ?? [];
  const appHeaders = rules.get("/convert/*") ?? [];
  const assetHeaders = rules.get("/convert/assets/*") ?? [];
  const serviceWorkerHeaders = rules.get("/convert/service-worker.js") ?? [];
  const manifestHeaders = rules.get("/convert/manifest.webmanifest") ?? [];

  invariant(
    includesDirective(globalHeaders, "X-Content-Type-Options: nosniff"),
    "global nosniff header is missing",
  );
  const globalCsp = globalHeaders.find((directive) =>
    directive.startsWith("Content-Security-Policy:"),
  );
  invariant(globalCsp, "global CSP is missing");
  invariant(
    !globalCsp.includes("cloudflareinsights"),
    "marketing CSP unexpectedly enables analytics",
  );
  invariant(
    includesDirective(appHeaders, "! Content-Security-Policy"),
    "/convert/ must replace the marketing-site CSP",
  );
  const appCsp = appHeaders.find((directive) => directive.startsWith("Content-Security-Policy:"));
  invariant(appCsp, "/convert/ CSP is missing");
  for (const policy of [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
  ]) {
    invariant(appCsp.includes(policy), `/convert/ CSP is missing ${policy}`);
  }
  invariant(!appCsp.includes("cloudflareinsights"), "/convert/ CSP unexpectedly enables analytics");
  invariant(
    !appCsp.includes("api.github.com"),
    "/convert/ CSP unexpectedly enables GitHub API access",
  );
  invariant(
    includesDirective(assetHeaders, "Cache-Control: public, max-age=31536000, immutable"),
    "immutable /convert/assets caching is missing",
  );
  invariant(
    includesDirective(serviceWorkerHeaders, "Cache-Control: no-store"),
    "service worker no-store policy is missing",
  );
  invariant(
    includesDirective(manifestHeaders, "Cache-Control: no-cache"),
    "manifest no-cache policy is missing",
  );
}

async function assertConvertDocument(distributionRoot, convertRoot) {
  const indexPath = resolve(convertRoot, "index.html");
  const indexHtml = await readText(indexPath, "convert/index.html");
  const resourceUrls = [
    ...indexHtml.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/giu),
    ...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu),
  ].map((match) => match[1]);
  invariant(resourceUrls.length > 0, "convert/index.html has no resource URLs");

  for (const resourceUrl of resourceUrls) {
    invariant(
      resourceUrl.startsWith("/convert/"),
      `unscoped converter resource URL: ${resourceUrl}`,
    );
    const parsed = new URL(resourceUrl, SITE_ORIGIN);
    invariant(parsed.origin === SITE_ORIGIN, `cross-origin converter resource URL: ${resourceUrl}`);
    invariant(
      !parsed.search && !parsed.hash,
      `converter resource URL must be immutable: ${resourceUrl}`,
    );
    const localPath = resolve(distributionRoot, `.${decodeURIComponent(parsed.pathname)}`);
    invariant(
      isWithin(convertRoot, localPath),
      `converter resource escaped /convert/: ${resourceUrl}`,
    );
    await assertRegularFile(localPath, resourceUrl);
  }

  const eagerEnginePattern =
    /(?:\.wasm|(?:archive|pdf-codec|raster-codec|svg-codec|pdf)\.worker-)/u;
  invariant(
    !eagerEnginePattern.test(indexHtml),
    "converter index eagerly references an engine asset",
  );

  const manifest = JSON.parse(
    await readText(resolve(convertRoot, "manifest.webmanifest"), "convert/manifest.webmanifest"),
  );
  for (const field of ["id", "scope", "start_url"]) {
    invariant(manifest[field] === "/convert/", `manifest ${field} must equal /convert/`);
  }
  invariant(
    Array.isArray(manifest.icons) && manifest.icons.length >= 2,
    "manifest icons are missing",
  );
  for (const icon of manifest.icons) {
    invariant(
      typeof icon.src === "string" && icon.src.startsWith("/convert/"),
      "manifest icon is unscoped",
    );
    const localPath = resolve(distributionRoot, `.${decodeURIComponent(icon.src)}`);
    invariant(isWithin(convertRoot, localPath), `manifest icon escaped /convert/: ${icon.src}`);
    await assertRegularFile(localPath, icon.src);
  }

  const serviceWorker = await readText(
    resolve(convertRoot, "service-worker.js"),
    "convert/service-worker.js",
  );
  invariant(
    serviceWorker.includes('scopePath: "/convert/"'),
    "service worker scope is not /convert/",
  );
  invariant(
    serviceWorker.includes('cachePrefix: "imgconvert-web:"'),
    "service worker cache prefix is not ImgConvert-specific",
  );
  invariant(
    serviceWorker.includes("!url.pathname.startsWith(BUILD.scopePath)"),
    "service worker fetch handler lacks a /convert/ boundary",
  );
  const precacheMatch = serviceWorker.match(/precacheUrls:\s*(\[[^\n]+\])/u);
  invariant(precacheMatch?.[1], "service worker precache list is missing");
  const precacheUrls = JSON.parse(precacheMatch[1]);
  invariant(
    Array.isArray(precacheUrls) && precacheUrls.length > 0,
    "service worker precache list is empty",
  );
  for (const url of precacheUrls) {
    invariant(
      typeof url === "string" && url.startsWith("/convert/"),
      `unscoped precache URL: ${url}`,
    );
    invariant(!eagerEnginePattern.test(url), `engine must remain lazy-loaded: ${url}`);
  }
}

export async function checkWebRelease(repositoryRoot) {
  const canonicalRoot = await realpath(resolve(repositoryRoot));
  const distributionRoot = resolve(canonicalRoot, "website/dist");
  const convertRoot = resolve(distributionRoot, "convert");
  invariant(isWithin(canonicalRoot, distributionRoot), "website/dist escaped the repository root");
  invariant(isWithin(distributionRoot, convertRoot), "convert escaped website/dist");
  invariant(
    (await realpath(distributionRoot)) === distributionRoot,
    "website/dist is not canonical",
  );
  invariant((await realpath(convertRoot)) === convertRoot, "website/dist/convert is not canonical");

  const files = await listFiles(distributionRoot);
  invariant(files.length > 0, "website/dist is empty");

  for (const route of REQUIRED_ROUTES) {
    await assertRegularFile(routeFile(distributionRoot, route), `${route} route`);
  }
  for (const asset of ["_headers", "robots.txt", "sitemap.xml", "site.webmanifest", "404.html"]) {
    await assertRegularFile(resolve(distributionRoot, asset), asset);
  }

  const sitemap = await readText(resolve(distributionRoot, "sitemap.xml"), "sitemap.xml");
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
  invariant(sitemapUrls.length > 0, "sitemap has no URLs");
  for (const value of sitemapUrls) {
    const url = new URL(value);
    invariant(url.origin === SITE_ORIGIN, `sitemap contains a foreign origin: ${value}`);
    await assertRegularFile(
      routeFile(distributionRoot, url.pathname),
      `sitemap route ${url.pathname}`,
    );
  }

  for (const route of ["/", "/en/"]) {
    const homepage = await readText(routeFile(distributionRoot, route), `${route} homepage`);
    invariant(
      homepage.includes('href="/convert/"'),
      `${route} homepage is missing the Web app entry`,
    );
    invariant(
      !/\.wasm|pdf-codec|svg-codec|raster-codec/u.test(homepage),
      `${route} homepage references converter engines`,
    );
  }
  for (const route of REQUIRED_CONTENT_ROUTES) {
    const page = await readText(routeFile(distributionRoot, route), `${route} content page`);
    invariant(
      page.includes('href="/convert/"'),
      `${route} content page is missing the Web app entry`,
    );
  }
  invariant(
    !files.some((file) => !isWithin(convertRoot, file) && extname(file) === ".wasm"),
    "marketing release contains converter WASM outside /convert/",
  );

  await assertConvertDocument(distributionRoot, convertRoot);
  assertHeaders(await readText(resolve(distributionRoot, "_headers"), "_headers"));

  const extensionCounts = new Map();
  for (const pathname of files.filter((file) => isWithin(convertRoot, file))) {
    const extension = extname(pathname) || "[none]";
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  return {
    convertFiles: [...extensionCounts.values()].reduce((total, count) => total + count, 0),
    extensionCounts: Object.fromEntries(
      [...extensionCounts].sort(([left], [right]) => left.localeCompare(right)),
    ),
    routes: REQUIRED_ROUTES.length,
    totalFiles: files.length,
  };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const result = await checkWebRelease(repositoryRoot);
  process.stdout.write(
    `Checked ${result.routes} routes and ${result.convertFiles} converter files (${result.totalFiles} total release files).\n`,
  );
}
