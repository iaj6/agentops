import { defineConfig, devices } from "@playwright/test";

// Playwright config for the AgentOps dashboard. Run against the local
// Next.js dev server — Playwright starts it automatically (reuses one
// already running on :3000 if you've got it open in another terminal).
//
//   npm run test:e2e --workspace=packages/web

export default defineConfig({
  testDir: "./e2e",
  // Smoke tests today. Fully parallelizable; bump retries if it
  // ever gets flaky against the dev server.
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: process.env["CI"] ? "github" : "list",

  // Ensure the test admin user exists with a known password before any test runs.
  globalSetup: "./e2e/global-setup",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Tests own their own auth via beforeEach; no storageState fixture.
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Set PWSLOWMO=500 (or any ms) to slow down each action when
        // watching headed runs. No effect on CI / default local runs.
        launchOptions: process.env["PWSLOWMO"]
          ? { slowMo: Number(process.env["PWSLOWMO"]) }
          : {},
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
