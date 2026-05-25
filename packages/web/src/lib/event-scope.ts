import { listRuns, listSessions } from "@agentops/db";
import { db } from "./db";

/**
 * Events carry a sourceId but no user id of their own. To scope the
 * Events page (and its sub-APIs) to one user we resolve the set of
 * source IDs they own — every run and session attributed to them —
 * and pass that as the filter.
 *
 * Returns `undefined` when no userId is supplied (caller wants the
 * unscoped team view), and `[]` when the user owns nothing (caller
 * should match no events — NOT fall back to the team view).
 */
export function resolveOwnedSourceIds(userId?: string): readonly string[] | undefined {
  if (!userId) return undefined;
  const d = db();
  const runs = listRuns(d, { userId, limit: 10000 });
  const sessions = listSessions(d, { userId, limit: 10000 });
  return Array.from(
    new Set<string>([
      ...runs.map((r) => r.id as string),
      ...sessions.map((s) => s.id as string),
    ]),
  );
}
