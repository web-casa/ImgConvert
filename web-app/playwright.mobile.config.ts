import { defineConfig, devices } from "@playwright/test";

import { LOCAL_BASE_URL, previewBaseUrl } from "./playwright.shared";

const remoteBaseUrl = previewBaseUrl();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mobile.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  timeout: remoteBaseUrl ? 120_000 : 45_000,
  workers: 1,
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
    { name: "android-chromium-emulation", use: { ...devices["Pixel 7"] } },
    { name: "ios-webkit-emulation", use: { ...devices["iPhone 13"] } },
  ],
});
