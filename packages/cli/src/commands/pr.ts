import { Command } from "commander";
import { createRunId, computeScore, MergeRecommendation } from "@agentops/core";
import type { Run, ScoreCard } from "@agentops/core";
import { getDb, getRun, updateRun, listPolicies } from "@agentops/db";
import { createPR, addPRComment, isGhAvailable } from "../github.js";

export function registerPRCommand(program: Command): void {
  program
    .command("pr")
    .description("Create a GitHub PR from a completed run")
    .argument("<runId>", "The run ID")
    .option("--base <branch>", "Base branch for the PR", "main")
    .action((runId: string, opts: { base: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      if (!isGhAvailable()) {
        console.error(
          "GitHub CLI (gh) is not installed. Install it from https://cli.github.com",
        );
        process.exit(1);
      }

      const run = getRun(db, createRunId(runId));
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const activePolicies = listPolicies(db, { enabled: true });
      const score = computeScore(run, activePolicies);
      const body = buildPRBody(run, score);
      const title = buildPRTitle(run);

      const pr = createPR(title, body, opts.base);
      if (!pr) {
        console.error("Failed to create PR. Check that you have commits to push and gh is authenticated.");
        process.exit(1);
      }

      // Link the PR back to the run
      updateRun(db, run.id, {
        github: { ...run.github, pr },
        updatedAt: new Date().toISOString(),
      } as Partial<typeof run>);

      // If there are policy violations, add a warning comment
      const policyChecks = run.evaluations.flatMap((e) => e.policyChecks);
      const violations = policyChecks.filter((c) => !c.passed);
      if (violations.length > 0) {
        const warning = [
          "## Policy Violations",
          "",
          ...violations.map(
            (v) => `- **${v.policyId}**: ${v.message}`,
          ),
          "",
          "Please review these violations before merging.",
        ].join("\n");
        addPRComment(pr.number, warning);
      }

      if (json) {
        console.log(JSON.stringify({ runId, pr, score }));
      } else {
        console.log(`PR #${pr.number} created: ${pr.url}`);
        console.log(`  Title: ${pr.title}`);
        console.log(
          `  Merge recommendation: ${recommendationLabel(score.mergeRecommendation)}`,
        );
        if (violations.length > 0) {
          console.log(
            `  Warning: ${violations.length} policy violation(s) flagged on PR`,
          );
        }
      }
    });
}

function buildPRTitle(run: Run): string {
  const goal = run.goal.humanReadable;
  // Truncate to keep PR title reasonable
  if (goal.length <= 70) return goal;
  return goal.slice(0, 67) + "...";
}

function buildPRBody(run: Run, score: ScoreCard): string {
  const lines: string[] = [];

  lines.push(`## Run Summary`);
  lines.push("");
  lines.push(`- **Run ID:** \`${run.id}\``);
  lines.push(`- **Status:** ${run.status}`);
  lines.push(`- **Goal:** ${run.goal.humanReadable}`);
  lines.push("");

  // Metrics
  lines.push("## Metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Tokens | ${run.metrics.tokenUsage.total} |`);
  lines.push(`| Cost | $${run.metrics.costUsd.toFixed(2)} |`);
  lines.push(`| Duration | ${run.metrics.wallTimeMs}ms |`);
  lines.push("");

  // Test results
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length > 0) {
    const passed = allTests.filter((t) => t.passed).length;
    lines.push("## Test Results");
    lines.push("");
    lines.push(`${passed}/${allTests.length} tests passing`);
    lines.push("");
    for (const t of allTests) {
      const icon = t.passed ? "+" : "-";
      lines.push(`- [${icon}] ${t.name} (${t.duration}ms)`);
    }
    lines.push("");
  }

  // Policy results
  const allPolicies = run.evaluations.flatMap((e) => e.policyChecks);
  if (allPolicies.length > 0) {
    const passed = allPolicies.filter((p) => p.passed).length;
    lines.push("## Policy Results");
    lines.push("");
    lines.push(`${passed}/${allPolicies.length} policies passing`);
    lines.push("");
    for (const p of allPolicies) {
      const icon = p.passed ? "+" : "-";
      lines.push(`- [${icon}] ${p.policyId}: ${p.message}`);
    }
    lines.push("");
  }

  // Score card
  lines.push("## Score Card");
  lines.push("");
  lines.push(`| Dimension | Score |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| Correctness | ${fmtPct(score.correctness.score)} |`);
  lines.push(`| Regression Risk | ${fmtPct(score.regressionRisk.score)} |`);
  lines.push(`| Scope Risk | ${fmtPct(score.scopeRisk.score)} |`);
  lines.push(`| Policy Compliance | ${fmtPct(score.policyCompliance.score)} |`);
  lines.push(`| Unknowns | ${fmtPct(score.unknowns.score)} |`);
  lines.push("");

  // Merge recommendation
  lines.push("## Merge Recommendation");
  lines.push("");
  lines.push(`**${recommendationLabel(score.mergeRecommendation)}**`);
  lines.push("");

  lines.push("---");
  lines.push("*Generated by AgentOps*");

  return lines.join("\n");
}

function fmtPct(score: number): string {
  return `${(score * 100).toFixed(0)}%`;
}

function recommendationLabel(rec: MergeRecommendation): string {
  switch (rec) {
    case MergeRecommendation.Merge:
      return "MERGE - Safe to merge";
    case MergeRecommendation.Block:
      return "BLOCK - Do not merge";
    case MergeRecommendation.Review:
      return "REVIEW - Manual review required";
  }
}
