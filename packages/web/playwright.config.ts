import { defineConfig, devices } from "@playwright/test";

// Playwright config for the AgentOps dashboard. Runs against a PRODUCTION
// build (next start), NOT `next dev`: the Turbopack dev server compiles
// chunks on demand, which races with Playwright navigation and produces
// flaky "Failed to load chunk" errors. A production build serves stable,
// pre-compiled chunks.
//
// The app must be built first (CI does this; locally run it once):
//   npm run build                      # builds @agentops/* deps + web
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
    // Production server (requires a prior `npm run build`). Not `next dev`.
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
