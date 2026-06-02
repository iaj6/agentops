import { test, expect } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./global-setup";

// Smoke test for the Runs page (admin fleet-overview view).
// Mirrors the screenshot of /runs: headline + subtitle, six metric cards,
// "Most Active Repos" chip strip, "Recent Runs" section with results,
// and a "Live Activity" panel on the right.
//
// Assertions are structural — we check labels and visible affordances,
// not specific dollar amounts (those move with each demo-seed run).

test.describe("/runs — admin fleet overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Land anywhere outside /login; subsequent goto picks up the cookie.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  });

  test("renders headline, six metric cards, repos chip strip, recent runs", async ({
    page,
  }) => {
    await page.goto("/runs");

    // ── Headline + admin-scope subtitle ──────────────────────────────
    await expect(
      page.getByRole("heading", { name: "Runs", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Fleet overview — every user's runs"),
    ).toBeVisible();

    // ── Six MetricCards from the screenshot ──────────────────────────
    const metricLabels = [
      "Total Spend",
      "Total Runs",
      "Running Now",
      "Success Rate",
      "Today",
      "This Week",
    ];
    for (const label of metricLabels) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // Total Spend shows a dollar amount (regex; resilient to demo data).
    const totalSpendCard = page
      .locator("div")
      .filter({ has: page.getByText("Total Spend", { exact: true }) })
      .first();
    await expect(totalSpendCard).toContainText(/\$[\d,.]+/);

    // Success Rate shows a percentage.
    const successRateCard = page
      .locator("div")
      .filter({ has: page.getByText("Success Rate", { exact: true }) })
      .first();
    await expect(successRateCard).toContainText(/\d+(\.\d+)?%/);

    // ── Most Active Repos (This Week) chip strip ─────────────────────
    await expect(
      page.getByText("Most Active Repos (This Week)"),
    ).toBeVisible();
    // At least one repo chip — demo-seed produces 5 acme/* repos.
    await expect(page.getByText(/acme\/\w+/).first()).toBeVisible();

    // ── Recent Runs section + search input ───────────────────────────
    await expect(
      page.getByRole("heading", { name: /recent runs/i }),
    ).toBeVisible();
    // Two inputs share this placeholder (the global Cmd+K palette in the
    // app shell + the inline runs filter). Either being visible proves
    // the search affordance is on the page.
    await expect(
      page.getByPlaceholder(/search runs/i).first(),
    ).toBeVisible();

    // ── At least one run row appears (duration regex: "6m 34s") ──────
    await expect(page.getByText(/\b\d+m \d+s\b/).first()).toBeVisible();

    // ── Live Activity panel (right column) ───────────────────────────
    await expect(page.getByText(/live activity/i)).toBeVisible();
  });

  test("admin scope: user filter lists every seeded teammate", async ({
    page,
  }) => {
    await page.goto("/runs");

    // The user-filter <select> on the runs page renders one <option>
    // per known user. <option>s inside a collapsed <select> are
    // attached to the DOM but not "visible" in Playwright's sense, so
    // we assert allTextContents() rather than visibility — that proves
    // the admin can pivot the view to any teammate (fleet scope), even
    // without opening the dropdown.
    const userFilter = page.locator("select").first();
    await expect(userFilter).toBeVisible();

    const optionTexts = await userFilter.locator("option").allTextContents();
    // demo-seed creates these names; if they ever change, update here.
    for (const name of ["Sarah Chen", "Marcus Johnson", "Priya Patel"]) {
      expect(optionTexts).toContain(name);
    }
  });
});
