import { Command } from "commander";
import {
  getDb,
  listRuns,
  listSessions,
  updateRun,
  updateSession,
  insertEvent,
} from "@agentops/db";
import {
  isStaleRun,
  isStaleSession,
  STALE_THRESHOLD_MS,
  createEvent,
  EventCategory,
  EVENT_TYPES,
  failRun,
  terminateSession,
} from "@agentops/core";

// `agentops cleanup` — reap stale runs and sessions left over from crashed
// or force-quit Claude Code processes. A run/session is "stale" if it's
// still in a live status but hasn't heartbeat / been updated within the
// configured threshold (default 30 minutes).
//
// Defaults to a dry run preview. Pass --apply to actually reap.

interface CleanupOpts {
  staleSessions?: boolean;
  staleRuns?: boolean;
  thresholdMinutes?: string;
  apply?: boolean;
}

export function registerCleanupCommand(program: Command): void {
  program
    .command("cleanup")
    .description("Reap stale running runs and active sessions left behind by crashed Claude Code processes")
    .option("--stale-sessions", "Reap stale active sessions")
    .option("--stale-runs", "Reap stale running runs")
    .option("--threshold-minutes <n>", "Override staleness threshold (default 30)")
    .option("--apply", "Actually reap (default is a dry-run preview)")
    .action(async (opts: CleanupOpts) => {
      const dbPath = (program.opts()["dbPath"] as string | undefined);
      const json = program.opts()["json"] as boolean | undefined;
      const apply = !!opts.apply;

      // If neither flag is set, do both — that's the obvious default
      // when the operator just runs `agentops cleanup`.
      const doRuns = !!opts.staleRuns || !opts.staleSessions;
      const doSessions = !!opts.staleSessions || !opts.staleRuns;

      const thresholdMs = opts.thresholdMinutes
        ? Math.max(1, parseInt(opts.thresholdMinutes, 10)) * 60 * 1000
        : STALE_THRESHOLD_MS;
      const now = Date.now();

      const db = getDb(dbPath);

      const staleRuns = doRuns
        ? listRuns(db, { limit: 100000 }).filter((r) =>
            isStaleRun(r, thresholdMs, now),
          )
        : [];
      const staleSessions = doSessions
        ? listSessions(db, { limit: 100000 }).filter((s) =>
            isStaleSession(s, thresholdMs, now),
          )
        : [];

      if (json) {
        console.log(
          JSON.stringify({
            applied: apply,
            thresholdMinutes: Math.round(thresholdMs / 60000),
            staleRuns: staleRuns.map((r) => ({
              id: r.id,
              repo: r.environment.repo,
              updatedAt: r.updatedAt,
            })),
            staleSessions: staleSessions.map((s) => ({
              id: s.id,
              agentId: s.agentId,
              lastHeartbeatAt: s.lastHeartbeatAt,
            })),
          }),
        );
      } else {
        const verb = apply ? "Reaped" : "Would reap";
        console.log(
          `${verb} ${staleRuns.length} stale run(s) and ${staleSessions.length} stale session(s) ` +
            `(threshold: ${Math.round(thresholdMs / 60000)} min).`,
        );
        if (!apply) {
          console.log("Re-run with --apply to actually reap.");
        }
        for (const r of staleRuns) {
          console.log(
            `  run  ${(r.id as string).slice(0, 24)}  ${r.environment.repo}  updated ${r.updatedAt}`,
          );
        }
        for (const s of staleSessions) {
          console.log(
            `  sess ${(s.id as string).slice(0, 24)}  ${s.agentId as string}  heartbeat ${s.lastHeartbeatAt}`,
          );
        }
      }

      if (!apply) return;

      // Apply: mark runs as failed, sessions as terminated. Emit an event
      // for each so the audit trail shows the reaper, not a silent edit.
      for (const r of staleRuns) {
        const failed = failRun(r, "stale — no heartbeat in 30+ min, reaped by agentops cleanup");
        updateRun(db, failed.id, {
          status: failed.status,
          decisions: failed.decisions,
          updatedAt: failed.updatedAt,
        });
        insertEvent(
          db,
          createEvent(EventCategory.Run, EVENT_TYPES["run.failed"], r.id as string, {
            reason: "stale",
            reapedAt: new Date(now).toISOString(),
          }),
        );
      }
      for (const s of staleSessions) {
        const terminated = terminateSession(s);
        updateSession(db, terminated.id, {
          status: terminated.status,
          terminatedAt: terminated.terminatedAt,
          updatedAt: terminated.updatedAt,
        });
        insertEvent(
          db,
          createEvent(
            EventCategory.Session,
            EVENT_TYPES["session.terminated"],
            s.id as string,
            { reason: "stale", reapedAt: new Date(now).toISOString() },
          ),
        );
      }
    });
}
