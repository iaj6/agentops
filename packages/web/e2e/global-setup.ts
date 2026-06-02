// Ensures a known test-admin user exists with a known password in the
// local AgentOps SQLite DB before Playwright runs. Idempotent — safe to
// re-run. We use a dedicated e2e user (not the developer's real Ian /
// Sarah accounts) so interactive sessions are never disturbed.
//
// @agentops/db is ESM-only ("type": "module"). Playwright transpiles
// this file to CJS, so we dynamic-import the package — the official
// escape hatch for loading ESM from a CJS context.

export const E2E_ADMIN_EMAIL = "e2e-admin@example.com";
export const E2E_ADMIN_PASSWORD = "e2e-admin-password-do-not-use-in-prod";

export default async function globalSetup(): Promise<void> {
  const { getDb, insertUser, getUserByEmail, setUserPassword } =
    await import("@agentops/db");

  const db = getDb();
  const existing = getUserByEmail(db, E2E_ADMIN_EMAIL);

  if (existing) {
    // Always reset the password — a previous run may have rotated it.
    setUserPassword(db, existing.id, E2E_ADMIN_PASSWORD);
    return;
  }

  insertUser(db, {
    email: E2E_ADMIN_EMAIL,
    name: "E2E Admin",
    role: "admin",
    password: E2E_ADMIN_PASSWORD,
  });
}
