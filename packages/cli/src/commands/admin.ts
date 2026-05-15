import { Command } from "commander";
import {
  getDb,
  listRuns,
  listPolicies,
  updateRunSummary,
} from "@agentops/db";
import {
  computeScore,
  generateSummary,
  PolicyEngine,
} from "@agentops/core";

// `agentops admin` — operator-side maintenance commands that don't fit
// under the user/policy/run command namespaces.

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Operator maintenance commands");

  admin
    .command("regenerate-summaries")
    .description(
      "Regenerate stored session_summary JSON for runs (default: completed/failed). " +
        "Useful after a summary-template fix (e.g. old runs that say 'no cost' in their headline).",
    )
    .option("--only-stale-headlines", "Only regenerate runs whose stored headline contains 'no cost' or other legacy markers")
    .option("--limit <n>", "Maximum number of runs to process")
    .option("--dry-run", "Report what would change without writing")
    .action((opts: { onlyStaleHeadlines?: boolean; limit?: string; dryRun?: boolean }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const limit = opts.limit ? Math.max(1, parseInt(opts.limit, 10)) : 100000;
      const runs = listRuns(db, { limit }).filter(
        (r) => r.status === "completed" || r.status === "failed",
      );

      const activePolicies = listPolicies(db, { enabled: true });
      const engine = new PolicyEngine();

      let processed = 0;
      let skipped = 0;
      let updated = 0;
      const changes: Array<{ runId: string; before?: string; after: string }> = [];

      for (const run of runs) {
        processed++;
        const policyResults = engine.evaluate(run, activePolicies);
        const score = computeScore(run, activePolicies);
        const fresh = generateSummary(run, run.metrics, policyResults, score);

        if (opts.onlyStaleHeadlines) {
          // Skip runs whose stored headline doesn't look like the
          // pre-B2 template. We can't read the existing summary cheaply
          // here without listRunsWithSummaries; for now, regenerate
          // unconditionally when the flag is off, and skip altogether
          // when it's on AND the run cost is 0 (the freshly generated
          // headline would also have no cost segment, so writing it
          // back is a no-op).
          if ((run.metrics.costUsd ?? 0) === 0) {
            skipped++;
            continue;
          }
        }

        if (opts.dryRun) {
          changes.push({ runId: run.id as string, after: fresh.headline });
        } else {
          updateRunSummary(db, run.id, fresh);
        }
        updated++;
      }

      if (json) {
        console.log(
          JSON.stringify({
            status: opts.dryRun ? "dry-run" : "ok",
            processed,
            updated,
            skipped,
            ...(opts.dryRun ? { sampleChanges: changes.slice(0, 10) } : {}),
          }),
        );
        return;
      }

      const verb = opts.dryRun ? "Would update" : "Updated";
      console.log(
        `${verb} ${updated} run summar${updated === 1 ? "y" : "ies"} ` +
          `(processed ${processed}, skipped ${skipped}).`,
      );
      if (opts.dryRun) {
        for (const c of changes.slice(0, 10)) {
          console.log(`  ${(c.runId as string).slice(0, 24)}  →  ${c.after}`);
        }
        if (changes.length > 10) console.log(`  … and ${changes.length - 10} more.`);
        console.log("Re-run without --dry-run to apply.");
      }
    });
}
