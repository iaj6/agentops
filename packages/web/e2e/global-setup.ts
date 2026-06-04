// Provisions a deterministic dataset in the local AgentOps SQLite DB before
// Playwright runs, so the smoke tests don't depend on a developer's
// hand-populated DB (which is why they failed in CI). Idempotent.
//
// @agentops/db is ESM-only ("type": "module"). Playwright transpiles this
// file to CJS, so we dynamic-import the package — the official escape hatch
// for loading ESM from a CJS context.

export const E2E_ADMIN_EMAIL = "e2e-admin@example.com";
export const E2E_ADMIN_PASSWORD = "e2e-admin-password-do-not-use-in-prod";

// Teammates the /runs admin-scope test expects in the user filter. Created
// here so the assertion is deterministic regardless of DB contents.
const E2E_TEAMMATES: ReadonlyArray<{ email: string; name: string }> = [
  { email: "e2e-sarah@example.com", name: "Sarah Chen" },
  { email: "e2e-marcus@example.com", name: "Marcus Johnson" },
  { email: "e2e-priya@example.com", name: "Priya Patel" },
];

export default async function globalSetup(): Promise<void> {
  const { getDb, insertUser, getUserByEmail, setUserPassword, listRuns, seed } =
    await import("@agentops/db");

  const db = getDb();

  // Seed demo runs/repos/policies once (only when the DB is empty) so the
  // fleet-overview assertions — metric cards, "Most Active Repos" (acme/*),
  // recent-run rows with durations — have data to render.
  if (listRuns(db, { limit: 1 }).length === 0) {
    await seed(db);
  }

  // Admin the tests log in as. Always reset the password (a prior run may
  // have rotated it) — must satisfy the 12-char floor.
  const admin = getUserByEmail(db, E2E_ADMIN_EMAIL);
  if (admin) {
    setUserPassword(db, admin.id, E2E_ADMIN_PASSWORD);
  } else {
    insertUser(db, {
      email: E2E_ADMIN_EMAIL,
      name: "E2E Admin",
      role: "admin",
      password: E2E_ADMIN_PASSWORD,
    });
  }

  // Named teammates for the admin user-filter assertion.
  for (const { email, name } of E2E_TEAMMATES) {
    if (!getUserByEmail(db, email)) {
      insertUser(db, { email, name, role: "member", password: "e2e-teammate-placeholder-pw" });
    }
  }
}
