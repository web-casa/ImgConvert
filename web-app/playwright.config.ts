import { defineConfig, devices } from "@playwright/test";

const LOCAL_BASE_URL = "http://127.0.0.1:4175/convert/";

function previewBaseUrl(): string | undefined {
  const value = process.env.IMGCONVERT_WEB_PREVIEW_ORIGIN?.trim();
  if (!value) return undefined;

  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".pages.dev") ||
    origin.port !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error(
      "IMGCONVERT_WEB_PREVIEW_ORIGIN must be an HTTPS *.pages.dev origin without credentials, a port, path, query, or fragment.",
    );
  }
  return new URL("/convert/", origin).href;
}

const remoteBaseUrl = previewBaseUrl();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  timeout: remoteBaseUrl ? 120_000 : 30_000,
  // Remote cold loads can make three simultaneous AVIF WASM encoders compete for memory and CPU.
  // Keep the release gate deterministic; local runs retain Playwright's normal parallel workers.
  ...(remoteBaseUrl ? { workers: 1 } : {}),
  use: {
    baseURL: remoteBaseUrl ?? LOCAL_BASE_URL,
    trace: "retain-on-failure",
  },
  ...(remoteBaseUrl
    ? {}
    : {
        webServer: {
          command: "pnpm run preview",
          reuseExistingServer: false,
          timeout: 30_000,
          url: LOCAL_BASE_URL,
        },
      }),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
