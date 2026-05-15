import { Command } from "commander";
import {
  getDb,
  listRuns,
  listSessions,
  updateRun,
  updateSession,
  insertEvent,
  countRunsOlderThan,
  deleteOldRuns,
  vacuum,
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

// `agentops cleanup` — two responsibilities:
//   1. Reap stale runs/sessions left behind by crashed Claude Code
//      processes (Phase B5). Default behavior when no flags are given.
//   2. Retention: delete runs older than a cutoff plus their dependent
//      rows (policy_results, run_metrics, events). Opt-in via
//      `--runs-older-than <duration>` (Phase C3).
//
// Defaults to a dry-run preview for both. Pass --apply to actually mutate.

interface CleanupOpts {
  staleSessions?: boolean;
  staleRuns?: boolean;
  thresholdMinutes?: string;
  runsOlderThan?: string;
  vacuum?: boolean;
  apply?: boolean;
}

/**
 * Parse a duration string like "90d", "12w", "365d", or a bare number
 * (interpreted as days). Returns the number of milliseconds. Throws on
 * unparseable input.
 */
function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*([dwhm]?)$/.exec(input.trim());
  if (!m) {
    throw new Error(
      `Invalid duration "${input}". Use a number with optional unit: 90d, 12w, 24h, 60m.`,
    );
  }
  const n = parseInt(m[1]!, 10);
  const unit = (m[2] || "d") as "d" | "w" | "h" | "m";
  const multipliers = {
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
  };
  return n * multipliers[unit];
}

export function registerCleanupCommand(program: Command): void {
  program
    .command("cleanup")
    .description("Reap stale runs/sessions and (optionally) prune runs older than a retention cutoff")
    .option("--stale-sessions", "Reap stale active sessions")
    .option("--stale-runs", "Reap stale running runs")
    .option("--threshold-minutes <n>", "Override staleness threshold (default 30)")
    .option(
      "--runs-older-than <duration>",
      "Delete runs older than this (e.g. 90d, 12w). Cascades to policy_results, run_metrics, and matching events.",
    )
    .option("--vacuum", "Run SQLite VACUUM after deletion to reclaim space")
    .option("--apply", "Actually reap (default is a dry-run preview)")
    .action(async (opts: CleanupOpts) => {
      const dbPath = (program.opts()["dbPath"] as string | undefined);
      const json = program.opts()["json"] as boolean | undefined;
      const apply = !!opts.apply;

      // If no staleness or retention flag is set, do both stale paths —
      // that's the obvious default when the operator just runs
      // `agentops cleanup`. Retention is always explicit.
      const doRuns = !!opts.staleRuns || (!opts.staleSessions && !opts.runsOlderThan);
      const doSessions = !!opts.staleSessions || (!opts.staleRuns && !opts.runsOlderThan);
      const doRetention = !!opts.runsOlderThan;

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

      // Retention preview (Phase C3). Parse duration once; surface the
      // cutoff as an ISO string for clarity.
      let retentionCutoffISO: string | null = null;
      let retentionPreviewCount = 0;
      if (doRetention) {
        const ms = parseDurationMs(opts.runsOlderThan!);
        retentionCutoffISO = new Date(now - ms).toISOString();
        retentionPreviewCount = countRunsOlderThan(db, retentionCutoffISO);
      }

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
            retention: doRetention
              ? {
                  cutoff: retentionCutoffISO,
                  runs: retentionPreviewCount,
                  vacuum: !!opts.vacuum,
                }
              : null,
          }),
        );
      } else {
        const verb = apply ? "Reaped" : "Would reap";
        console.log(
          `${verb} ${staleRuns.length} stale run(s) and ${staleSessions.length} stale session(s) ` +
            `(threshold: ${Math.round(thresholdMs / 60000)} min).`,
        );
        if (doRetention) {
          const retVerb = apply ? "Deleted" : "Would delete";
          console.log(
            `${retVerb} ${retentionPreviewCount} run(s) older than ${opts.runsOlderThan} ` +
              `(before ${retentionCutoffISO}). Cascades to policy_results, run_metrics, and events.`,
          );
        }
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

      // Retention: prune old runs + their dependent rows. Done after the
      // stale-reap so any newly-failed runs still get the cascade if
      // they're also past the retention cutoff.
      if (doRetention && retentionCutoffISO) {
        const result = deleteOldRuns(db, retentionCutoffISO);
        if (!json) {
          console.log(
            `Pruned ${result.runs} run(s), ${result.policyResults} policy_result row(s), ` +
              `${result.runMetrics} run_metric row(s), ${result.events} event row(s).`,
          );
        }
        if (opts.vacuum) {
          if (!json) console.log("Running VACUUM…");
          vacuum(db);
        }
      }
    });
}
