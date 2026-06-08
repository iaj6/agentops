import type { AgentOpsDb } from "@agentops/db";
import { getUserByEmail, listUsers } from "@agentops/db";
import { readCredentials } from "./credentials.js";

/**
 * Resolve the local user a CLI-created run/session should be attributed to in
 * local (DirectOps) mode, which has no server-side auth context. Returns the
 * user's id, or null when attribution can't be determined.
 *
 * Precedence:
 *   1. credentials.json present → the LOCAL users-table row matching its email.
 *      We resolve by EMAIL, not by creds.user.id: that id is the *remote*
 *      dashboard's UUID and isn't guaranteed to exist in local SQLite. Matching
 *      on email lands the same local row the `cleanup --reassign-null-user`
 *      backfill ends up on (the backfill validates an operator-supplied id via
 *      getUserById) — both converge on the same local user for a single
 *      operator, just keyed differently (email here, id there).
 *   2. No credentials but exactly ONE local user → that user (the single-tenant
 *      "sole-user fallback"; convenient for the common one-operator trial DB).
 *   3. Otherwise null — genuinely anonymous local dev, or an ambiguous
 *      multi-user DB with no credentials. Preserves the prior NULL behavior.
 *
 * Fails open: this reads a file and touches the DB, so any error yields null
 * rather than throwing — a hook must never block or break a real agent run.
 */
export function resolveLocalUserId(db: AgentOpsDb): string | null {
  try {
    const creds = readCredentials();
    if (creds?.user?.email) {
      return getUserByEmail(db, creds.user.email)?.id ?? null;
    }
    const users = listUsers(db);
    if (users.length === 1) return users[0]!.id;
    return null;
  } catch {
    return null;
  }
}
