import { defineConfig } from "@playwright/test";

/**
 * E2E + reliability suite (plan §16, STEP-023). Tests spawn their own
 * server processes (they must be able to kill/restart them), so there is
 * no Playwright webServer entry. Serial by design: each test owns real
 * ports and real engine timers; parallelism buys nothing but flakes here.
 */
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
