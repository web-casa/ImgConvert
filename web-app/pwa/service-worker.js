// SPDX-License-Identifier: Apache-2.0

const BUILD = Object.freeze({
  buildId: "__IMGCONVERT_BUILD_ID__",
  cachePrefix: "__IMGCONVERT_CACHE_PREFIX__",
  compatibilityVersion: "__IMGCONVERT_COMPATIBILITY_VERSION__",
  precacheUrls: __IMGCONVERT_PRECACHE_URLS__, // eslint-disable-line no-undef
  scopePath: "__IMGCONVERT_SCOPE_PATH__",
});

const CACHE_NAMES = Object.freeze({
  engine: `${BUILD.cachePrefix}${BUILD.compatibilityVersion}:${BUILD.buildId}:engine`,
  shell: `${BUILD.cachePrefix}${BUILD.compatibilityVersion}:${BUILD.buildId}:shell`,
});
const CURRENT_CACHE_NAMES = new Set(Object.values(CACHE_NAMES));
const APP_URL = new URL(BUILD.scopePath, self.location.origin).href;
const ASSET_PATH_PREFIX = `${BUILD.scopePath}assets/`;
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|png|wasm)$/u;

function isCacheableResponse(response) {
  return response.ok && response.type === "basic";
}

function isScopedHashedAsset(url) {
  return (
    url.origin === self.location.origin &&
    url.search === "" &&
    url.pathname.startsWith(ASSET_PATH_PREFIX) &&
    HASHED_ASSET_PATTERN.test(url.pathname)
  );
}

function isEngineAsset(url) {
  return (
    url.pathname.endsWith(".wasm") ||
    /(?:archive|pdf-codec|raster-codec|svg-codec|pdf)\.worker-/u.test(url.pathname)
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await self.caches.open(cacheName);
  // The URL is already restricted to same-origin, scoped, content-hashed assets.
  // Ignore Vary so dev/proxy-added `Vary: Origin` cannot break the offline copy.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await self.fetch(request);
  if (isCacheableResponse(response)) await cache.put(request, response.clone());
  return response;
}

async function navigationNetworkFirst(request) {
  const cache = await self.caches.open(CACHE_NAMES.shell);
  try {
    const response = await self.fetch(request);
    const contentType = response.headers.get("content-type") ?? "";
    const requestUrl = new URL(request.url);
    const isCanonicalAppNavigation =
      requestUrl.pathname === BUILD.scopePath ||
      requestUrl.pathname === `${BUILD.scopePath}index.html`;
    if (
      isCanonicalAppNavigation &&
      isCacheableResponse(response) &&
      contentType.includes("text/html")
    ) {
      await cache.put(APP_URL, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(APP_URL, { ignoreVary: true })) ?? Response.error();
  }
}

async function offlineShellReady() {
  const cache = await self.caches.open(CACHE_NAMES.shell);
  const matches = await Promise.all(
    BUILD.precacheUrls.map((url) => cache.match(url, { ignoreVary: true })),
  );
  return matches.every(Boolean);
}

async function precacheOfflineShell() {
  const cache = await self.caches.open(CACHE_NAMES.shell);
  const requests = BUILD.precacheUrls.map(
    (url) => new Request(url, { cache: "reload", credentials: "same-origin" }),
  );
  await cache.addAll(requests);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOfflineShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(BUILD.cachePrefix) && !CURRENT_CACHE_NAMES.has(name))
          .map((name) => self.caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "IMGCONVERT_VERSION_REQUEST") {
    event.waitUntil(
      (async () => {
        event.ports[0]?.postMessage({
          buildId: BUILD.buildId,
          compatibilityVersion: BUILD.compatibilityVersion,
          offlineReady: await offlineShellReady(),
          type: "IMGCONVERT_VERSION_RESPONSE",
        });
      })(),
    );
    return;
  }
  if (data?.type === "IMGCONVERT_PREPARE_OFFLINE") {
    event.waitUntil(
      (async () => {
        try {
          await precacheOfflineShell();
          event.ports[0]?.postMessage({ ok: true, type: "IMGCONVERT_PREPARE_RESPONSE" });
        } catch {
          event.ports[0]?.postMessage({ ok: false, type: "IMGCONVERT_PREPARE_RESPONSE" });
        }
      })(),
    );
    return;
  }
  if (
    data?.type === "IMGCONVERT_ACTIVATE" &&
    data.buildId === BUILD.buildId &&
    data.compatibilityVersion === BUILD.compatibilityVersion
  ) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BUILD.scopePath)) return;
  if (request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }
  if (!isScopedHashedAsset(url)) return;
  event.respondWith(
    cacheFirst(request, isEngineAsset(url) ? CACHE_NAMES.engine : CACHE_NAMES.shell),
  );
});
