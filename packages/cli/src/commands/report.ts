import { Command } from "commander";
import { createRunId, computeScore, MergeRecommendation } from "@agentops/core";
import type { Run, ScoreCard } from "@agentops/core";
import { getDb, getRun, listPolicies } from "@agentops/db";

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Generate a RUN_REPORT.md for a run")
    .argument("<runId>", "The run ID")
    .action((runId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const run = getRun(db, createRunId(runId));
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const activePolicies = listPolicies(db, { enabled: true });
      const score = computeScore(run, activePolicies);

      if (json) {
        console.log(JSON.stringify({ run, score }, null, 2));
        return;
      }

      console.log(generateReport(run, score));
    });
}

function generateReport(run: Run, score: ScoreCard): string {
  const lines: string[] = [];

  lines.push(`# RUN_REPORT: ${run.id}`);
  lines.push("");

  // Goal
  lines.push("## Goal");
  lines.push("");
  lines.push(run.goal.humanReadable);
  lines.push("");

  // Status
  lines.push("## Status");
  lines.push("");
  lines.push(`- **Status:** ${run.status}`);
  lines.push(`- **Created:** ${run.createdAt}`);
  lines.push(`- **Updated:** ${run.updatedAt}`);
  lines.push("");

  // Agents
  lines.push("## Agents");
  lines.push("");
  if (run.agents.length === 0) {
    lines.push("No agents recorded.");
  } else {
    for (const agent of run.agents) {
      lines.push(`- **${agent.role}**: ${agent.model} (${agent.id})`);
    }
  }
  lines.push("");

  // Environment
  lines.push("## Environment");
  lines.push("");
  lines.push(`- **Repo:** ${run.environment.repo}`);
  lines.push(`- **Branch:** ${run.environment.branch}`);
  lines.push(`- **Sandbox:** ${run.environment.sandbox.enabled ? "enabled" : "disabled"}`);
  lines.push("");

  // Actions Summary
  lines.push("## Actions Summary");
  lines.push("");
  const totalToolCalls = run.actions.reduce(
    (sum, a) => sum + a.toolCalls.length,
    0,
  );
  const totalFileEdits = run.actions.reduce(
    (sum, a) => sum + a.fileEdits.length,
    0,
  );
  const totalCommands = run.actions.reduce(
    (sum, a) => sum + a.commands.length,
    0,
  );
  lines.push(`- **Actions:** ${run.actions.length}`);
  lines.push(`- **Tool calls:** ${totalToolCalls}`);
  lines.push(`- **File edits:** ${totalFileEdits}`);
  lines.push(`- **Commands:** ${totalCommands}`);
  lines.push("");

  // Metrics
  lines.push("## Metrics");
  lines.push("");
  lines.push(`- **Tokens:** ${run.metrics.tokenUsage.total} (in: ${run.metrics.tokenUsage.input}, out: ${run.metrics.tokenUsage.output})`);
  lines.push(`- **Cost:** $${run.metrics.costUsd.toFixed(2)}`);
  lines.push(`- **Wall time:** ${run.metrics.wallTimeMs}ms`);
  lines.push(`- **Flake rate:** ${(run.metrics.flakeRate * 100).toFixed(1)}%`);
  lines.push("");

  // Test Results
  lines.push("## Test Results");
  lines.push("");
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length === 0) {
    lines.push("No test results.");
  } else {
    for (const t of allTests) {
      const icon = t.passed ? "PASS" : "FAIL";
      lines.push(`- [${icon}] ${t.name} (${t.duration}ms) ${t.message}`);
    }
  }
  lines.push("");

  // Policy Results
  lines.push("## Policy Results");
  lines.push("");
  const allPolicyChecks = run.evaluations.flatMap((e) => e.policyChecks);
  if (allPolicyChecks.length === 0) {
    lines.push("No policy checks recorded.");
  } else {
    for (const p of allPolicyChecks) {
      const icon = p.passed ? "PASS" : "FAIL";
      lines.push(`- [${icon}] ${p.policyId}: ${p.message}`);
    }
  }
  lines.push("");

  // Score Card
  lines.push("## Score Card");
  lines.push("");
  lines.push(`| Dimension          | Score | Rationale |`);
  lines.push(`|--------------------|-------|-----------|`);
  lines.push(`| Correctness        | ${fmtScore(score.correctness.score)} | ${score.correctness.rationale} |`);
  lines.push(`| Regression Risk    | ${fmtScore(score.regressionRisk.score)} | ${score.regressionRisk.rationale} |`);
  lines.push(`| Scope Risk         | ${fmtScore(score.scopeRisk.score)} | ${score.scopeRisk.rationale} |`);
  lines.push(`| Policy Compliance  | ${fmtScore(score.policyCompliance.score)} | ${score.policyCompliance.rationale} |`);
  lines.push(`| Unknowns           | ${fmtScore(score.unknowns.score)} | ${score.unknowns.rationale} |`);
  lines.push("");

  // Merge Recommendation
  lines.push("## Merge Recommendation");
  lines.push("");
  const recLabel = recommendationLabel(score.mergeRecommendation);
  lines.push(`**${recLabel}**`);
  lines.push("");

  return lines.join("\n");
}

function fmtScore(score: number): string {
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
