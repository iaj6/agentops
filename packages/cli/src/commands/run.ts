import { Command } from "commander";
import {
  RunStatus,
  createRunId,
  createRun,
  startRun,
  completeRun,
  failRun,
  PolicyEngine,
  MergeRecommendation,
  computeScore,
  normalizeRepo,
} from "@agentops/core";
import type { Run } from "@agentops/core";
import { getDb, insertRun, getRun, listRuns, updateRun, listPolicies } from "@agentops/db";
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
          // Canonicalize so an explicit --repo (e.g. Acme/Repo or a remote URL)
          // buckets the same as wrap/hook/SDK-produced runs.
          repo: normalizeRepo(opts.repo),
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

      // Agent info
      if (r.agents.length > 0) {
        console.log();
        console.log(`Agents:`);
        for (const agent of r.agents) {
          console.log(`  ${agent.role}: ${agent.model} (${agent.id})`);
        }
      }

      // Actions breakdown
      const totalToolCalls = r.actions.reduce(
        (sum, a) => sum + a.toolCalls.length,
        0,
      );
      const totalFileEdits = r.actions.reduce(
        (sum, a) => sum + a.fileEdits.length,
        0,
      );
      const totalCommands = r.actions.reduce(
        (sum, a) => sum + a.commands.length,
        0,
      );
      console.log();
      console.log(`Actions: ${r.actions.length}`);
      console.log(`  Tool calls:  ${totalToolCalls}`);
      console.log(`  File edits:  ${totalFileEdits}`);
      console.log(`  Commands:    ${totalCommands}`);

      // Recent actions (last 5)
      if (r.actions.length > 0) {
        console.log();
        console.log(`Recent actions:`);
        const recent = r.actions.slice(-5);
        for (const action of recent) {
          const parts: string[] = [];
          if (action.commands.length > 0) {
            for (const cmd of action.commands) {
              parts.push(cmd.command);
            }
          }
          if (action.fileEdits.length > 0) {
            parts.push(`${action.fileEdits.length} file edits`);
          }
          if (action.toolCalls.length > 0) {
            for (const tc of action.toolCalls) {
              parts.push(`${tc.name}()`);
            }
          }
          console.log(`  ${action.id} [${action.timestamp}] ${parts.join(", ")}`);
        }
      }

      console.log();
      console.log(`Metrics:`);
      console.log(`  Tokens: ${r.metrics.tokenUsage.total}`);
      console.log(`  Cost:   $${r.metrics.costUsd.toFixed(2)}`);
      console.log(`  Time:   ${r.metrics.wallTimeMs}ms`);

      // Test results summary
      const allTests = r.evaluations.flatMap((e) => e.testResults);
      if (allTests.length > 0) {
        const passed = allTests.filter((t) => t.passed).length;
        const failed = allTests.length - passed;
        console.log();
        console.log(`Tests: ${passed} passed, ${failed} failed`);
        for (const t of allTests) {
          console.log(`  ${colorBool(t.passed)} ${t.name} (${t.duration}ms)`);
        }
      }

      // Policy results summary
      const allPolicyChecks = r.evaluations.flatMap((e) => e.policyChecks);
      if (allPolicyChecks.length > 0) {
        const passed = allPolicyChecks.filter((p) => p.passed).length;
        const failed = allPolicyChecks.length - passed;
        console.log();
        console.log(`Policies: ${passed} passed, ${failed} failed`);
        for (const p of allPolicyChecks) {
          console.log(`  ${colorBool(p.passed)} ${p.policyId}: ${p.message}`);
        }
      }

      // Score card and merge recommendation
      try {
        const activePolicies = listPolicies(db, { enabled: true });
        const score = computeScore(r, activePolicies);
        console.log();
        console.log(`Score Card:`);
        console.log(`  Correctness:       ${fmtPct(score.correctness.score)}`);
        console.log(`  Regression Risk:   ${fmtPct(score.regressionRisk.score)}`);
        console.log(`  Scope Risk:        ${fmtPct(score.scopeRisk.score)}`);
        console.log(`  Policy Compliance: ${fmtPct(score.policyCompliance.score)}`);
        console.log(`  Unknowns:          ${fmtPct(score.unknowns.score)}`);
        console.log();
        const rec = score.mergeRecommendation;
        const label =
          rec === MergeRecommendation.Merge
            ? "\x1b[32mMERGE - Safe to merge\x1b[0m"
            : rec === MergeRecommendation.Block
              ? "\x1b[31mBLOCK - Do not merge\x1b[0m"
              : "\x1b[33mREVIEW - Manual review required\x1b[0m";
        console.log(`Merge Recommendation: ${label}`);
      } catch {
        // Score computation may fail if no evaluations - that's ok
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
        // Normalize the filter to match the canonical form stored on write
        // (skip when absent so we don't turn "no filter" into an empty match).
        repo: opts.repo ? normalizeRepo(opts.repo) : opts.repo,
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

function fmtPct(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}
