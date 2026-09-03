// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

import { lstat, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_INSPECTED_BODY_BYTES = 5 * 1024 * 1024;
const HTML_ROUTES = [
  "/",
  "/en/",
  "/privacy/",
  "/en/privacy/",
  "/legal/",
  "/en/legal/",
  "/docs/",
  "/en/docs/",
  "/blog/",
  "/en/blog/",
  "/convert/",
];

function invariant(condition, message) {
  if (!condition) throw new Error(`Cloudflare preview smoke failed: ${message}`);
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..")
  );
}

export function parsePreviewOrigin(argv) {
  const values = argv.filter((value) => value.startsWith("--url="));
  invariant(values.length === 1, "pass exactly one --url=https://<preview>.pages.dev argument");
  const origin = new URL(values[0].slice("--url=".length));
  invariant(origin.protocol === "https:", "preview URL must use HTTPS");
  invariant(
    origin.hostname.endsWith(".pages.dev"),
    "preview URL must use a Cloudflare pages.dev host",
  );
  invariant(
    origin.username === "" && origin.password === "",
    "preview URL must not contain credentials",
  );
  invariant(
    origin.pathname === "/" && !origin.search && !origin.hash,
    "preview URL must be an origin only",
  );
  return origin.origin;
}

async function listFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const pathname = resolve(directory, entry.name);
      invariant(isWithin(root, pathname), `artifact escaped /convert/: ${pathname}`);
      const stats = await lstat(pathname);
      invariant(
        !stats.isSymbolicLink(),
        `artifact is a symbolic link: ${relative(root, pathname)}`,
      );
      if (stats.isDirectory()) await visit(pathname);
      else if (stats.isFile()) files.push(pathname);
      else invariant(false, `artifact is not a regular file: ${relative(root, pathname)}`);
    }
  }

  await visit(root);
  return files;
}

async function request(origin, pathname, expectedContentType, inspectBody = false) {
  const expectedUrl = new URL(pathname, origin);
  const response = await fetch(expectedUrl, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  invariant(response.ok, `${pathname} returned HTTP ${response.status}`);
  invariant(response.url === expectedUrl.href, `${pathname} resolved to an unexpected URL`);
  const contentType = response.headers.get("content-type") ?? "";
  invariant(
    expectedContentType.test(contentType),
    `${pathname} returned Content-Type ${contentType || "[missing]"}`,
  );
  invariant(
    response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    `${pathname} is missing X-Content-Type-Options: nosniff`,
  );

  if (inspectBody) {
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    invariant(contentLength <= MAX_INSPECTED_BODY_BYTES, `${pathname} body is unexpectedly large`);
    invariant(response.body, `${pathname} returned an empty body`);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        invariant(received <= MAX_INSPECTED_BODY_BYTES, `${pathname} body exceeded the read limit`);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    const body = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    );
    return { body, headers: response.headers };
  }
  await response.body?.cancel();
  return { body: "", headers: response.headers };
}

function assertCacheControl(headers, pathname, expectedTokens) {
  const cacheControl = (headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  for (const token of expectedTokens) {
    invariant(cacheControl.includes(token), `${pathname} Cache-Control is missing ${token}`);
  }
}

export function assertPreviewDocumentHeaders(headers, pathname) {
  const csp = headers.get("content-security-policy") ?? "";
  for (const policy of [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]) {
    invariant(csp.includes(policy), `${pathname} CSP is missing ${policy}`);
  }
  invariant(
    headers.get("x-frame-options")?.toUpperCase() === "DENY",
    `${pathname} is missing X-Frame-Options: DENY`,
  );
  invariant(
    headers.get("referrer-policy")?.toLowerCase() === "strict-origin-when-cross-origin",
    `${pathname} has an unexpected Referrer-Policy`,
  );
  const permissionsPolicy = headers.get("permissions-policy")?.toLowerCase() ?? "";
  for (const policy of ["camera=()", "geolocation=()", "microphone=()", "payment=()", "usb=()"]) {
    invariant(
      permissionsPolicy.includes(policy),
      `${pathname} Permissions-Policy allows ${policy}`,
    );
  }
  const robots = headers.get("x-robots-tag")?.toLowerCase() ?? "";
  invariant(
    robots.split(",").some((value) => value.trim() === "noindex"),
    `${pathname} is indexable`,
  );
}

export async function smokePreview(repositoryRoot, argv) {
  const origin = parsePreviewOrigin(argv);
  const convertRoot = resolve(repositoryRoot, "website/dist/convert");
  const files = await listFiles(convertRoot);

  for (const route of HTML_ROUTES) {
    const result = await request(origin, route, /^text\/html\b/iu, route === "/convert/");
    assertPreviewDocumentHeaders(result.headers, route);
    if (route === "/convert/") {
      const csp = result.headers.get("content-security-policy") ?? "";
      for (const policy of [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self'",
        "connect-src 'self'",
      ]) {
        invariant(csp.includes(policy), `/convert/ CSP is missing ${policy}`);
      }
      invariant(!csp.includes("cloudflareinsights"), "/convert/ CSP enables analytics");
      invariant(!csp.includes("api.github.com"), "/convert/ CSP enables GitHub API access");
      invariant(
        result.body.includes('href="/convert/manifest.webmanifest"'),
        "/convert/ returned the wrong app shell",
      );
    }
  }

  const manifest = await request(
    origin,
    "/convert/manifest.webmanifest",
    /^(?:application\/manifest\+json|application\/json)\b/iu,
    true,
  );
  assertCacheControl(manifest.headers, "/convert/manifest.webmanifest", ["no-cache"]);
  const manifestBody = JSON.parse(manifest.body);
  invariant(manifestBody.scope === "/convert/", "deployed manifest scope is not /convert/");

  const serviceWorker = await request(
    origin,
    "/convert/service-worker.js",
    /^(?:text|application)\/javascript\b/iu,
    true,
  );
  assertCacheControl(serviceWorker.headers, "/convert/service-worker.js", ["no-store"]);
  invariant(
    serviceWorker.body.includes('scopePath: "/convert/"'),
    "deployed service worker is unscoped",
  );

  const assets = files
    .map((pathname) => `/convert/${relative(convertRoot, pathname).split(sep).join("/")}`)
    .filter((pathname) => pathname.startsWith("/convert/assets/"));
  invariant(
    assets.some((pathname) => pathname.endsWith(".wasm")),
    "preview artifact has no WASM assets",
  );
  invariant(
    assets.some((pathname) => /\.worker-[^/]+\.(?:js|mjs)$/u.test(pathname)),
    "preview artifact has no worker assets",
  );

  for (const pathname of assets) {
    let expectedContentType;
    if (pathname.endsWith(".wasm")) expectedContentType = /^application\/wasm\b/iu;
    else if (pathname.endsWith(".css")) expectedContentType = /^text\/css\b/iu;
    else if (/\.(?:js|mjs)$/u.test(pathname))
      expectedContentType = /^(?:text|application)\/javascript\b/iu;
    else if (pathname.endsWith(".png")) expectedContentType = /^image\/png\b/iu;
    else continue;

    const result = await request(origin, pathname, expectedContentType);
    assertCacheControl(result.headers, pathname, ["public", "max-age=31536000", "immutable"]);
  }

  return { assets: assets.length, origin, routes: HTML_ROUTES.length };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  const repositoryRoot = resolve(dirname(currentFile), "..");
  const result = await smokePreview(repositoryRoot, process.argv.slice(2));
  process.stdout.write(
    `Cloudflare preview passed for ${result.origin}: ${result.routes} routes and ${result.assets} converter assets.\n`,
  );
}
