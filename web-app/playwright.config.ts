import { defineConfig, devices } from "@playwright/test";

import { LOCAL_BASE_URL, previewBaseUrl } from "./playwright.shared";

const remoteBaseUrl = previewBaseUrl();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "app.spec.ts",
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
