// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "environment.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "line",
  outputDir: ".output/environment-review",
  use: {
    baseURL: "http://127.0.0.1:4176",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: [
    {
      command: "pnpm --dir ../website preview --host 127.0.0.1 --port 4176 --strictPort",
      url: "http://127.0.0.1:4176/environment/",
      reuseExistingServer: false,
    },
    {
      command: "pnpm run preview",
      url: "http://127.0.0.1:4175/convert/",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
