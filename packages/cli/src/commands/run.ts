import { Command } from "commander";
import {
  RunStatus,
  createRunId,
  createRun,
  startRun,
  completeRun,
  failRun,
  PolicyEngine,
} from "@agentops/core";
import type { Run } from "@agentops/core";
import { getDb, insertRun, getRun, listRuns, updateRun } from "@agentops/db";
import { table, colorStatus, colorBool } from "../format.js";

export function registerRunCommands(program: Command): void {
  const run = program.command("run").description("Manage agent runs");

  run
    .command("start")
    .description("Create and start a new run")
    .argument("<goal>", "The goal for this run")
    .option("--repo <repo>", "Repository name", "unknown")
    .option("--branch <branch>", "Branch name", "main")
    .action((goal: string, opts: { repo: string; branch: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      let newRun = createRun(
        {
          humanReadable: goal,
          structured: { type: "task", description: goal, parameters: {} },
        },
        {
          repo: opts.repo,
          branch: opts.branch,
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
      );
      newRun = startRun(newRun);
      insertRun(db, newRun);

      if (json) {
        console.log(JSON.stringify({ id: newRun.id, status: newRun.status }));
      } else {
        console.log(`Run started: ${newRun.id}`);
      }
    });

  run
    .command("status")
    .description("Show run status and details")
    .argument("<runId>", "The run ID")
    .action((runId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const r = getRun(db, createRunId(runId));

      if (!r) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      if (json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }

      console.log(`Run:     ${r.id}`);
      console.log(`Status:  ${colorStatus(r.status)}`);
      console.log(`Goal:    ${r.goal.humanReadable}`);
      console.log(`Repo:    ${r.environment.repo}`);
      console.log(`Branch:  ${r.environment.branch}`);
      console.log(`Created: ${r.createdAt}`);
      console.log(`Updated: ${r.updatedAt}`);
      console.log();
      console.log(`Metrics:`);
      console.log(`  Tokens: ${r.metrics.tokenUsage.total}`);
      console.log(`  Cost:   $${r.metrics.costUsd.toFixed(2)}`);
      console.log(`  Time:   ${r.metrics.wallTimeMs}ms`);

      if (r.evaluations.length > 0) {
        console.log();
        console.log(`Evaluations:`);
        for (const ev of r.evaluations) {
          for (const t of ev.testResults) {
            console.log(`  ${colorBool(t.passed)} ${t.name} (${t.duration}ms)`);
          }
          for (const p of ev.policyChecks) {
            console.log(`  ${colorBool(p.passed)} Policy ${p.policyId}: ${p.message}`);
          }
        }
      }
    });

  run
    .command("list")
    .description("List recent runs")
    .option("--status <status>", "Filter by status")
    .option("--repo <repo>", "Filter by repo")
    .option("--limit <n>", "Max results", "20")
    .action((opts: { status?: string; repo?: string; limit: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = listRuns(db, {
        status: opts.status,
        repo: opts.repo,
        limit: parseInt(opts.limit, 10),
      });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No runs found.");
        return;
      }

      const rows = results.map((r) => [
        r.id as string,
        colorStatus(r.status),
        r.environment.repo,
        r.createdAt,
        `$${r.metrics.costUsd.toFixed(2)}`,
      ]);

      console.log(table(["ID", "Status", "Repo", "Created", "Cost"], rows));
    });

  run
    .command("complete")
    .description("Mark a run as completed")
    .argument("<runId>", "The run ID")
    .action((runId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const r = getRun(db, createRunId(runId));

      if (!r) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const completed = completeRun(r, {
        testResults: [],
        policyChecks: [],
        confidenceScore: 0,
      });
      updateRun(db, completed.id, {
        status: completed.status,
        evaluations: completed.evaluations,
        updatedAt: completed.updatedAt,
      });

      if (json) {
        console.log(JSON.stringify({ id: completed.id, status: completed.status }));
      } else {
        console.log(`Run ${runId} marked as completed.`);
      }
    });

  run
    .command("fail")
    .description("Mark a run as failed")
    .argument("<runId>", "The run ID")
    .requiredOption("--reason <reason>", "Failure reason")
    .action((runId: string, opts: { reason: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const r = getRun(db, createRunId(runId));

      if (!r) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const failed = failRun(r, opts.reason);
      updateRun(db, failed.id, {
        status: failed.status,
        decisions: failed.decisions,
        updatedAt: failed.updatedAt,
      });

      if (json) {
        console.log(JSON.stringify({ id: failed.id, status: failed.status }));
      } else {
        console.log(`Run ${runId} marked as failed: ${opts.reason}`);
      }
    });
}
