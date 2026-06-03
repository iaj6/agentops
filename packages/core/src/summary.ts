import type { Run, RunId, Metrics } from "./types.js";
import { RunStatus } from "./types.js";
import type { PolicyResult } from "./policy.js";
import type { ScoreCard } from "./scoring.js";
import type { AgentTimeline } from "./agent-tree.js";
import type { Backend } from "./pricing.js";

// ─── SessionSummary type ────────────────────────────────────────────────────

export interface SessionSummary {
  readonly runId: RunId;
  readonly generatedAt: string;
  readonly duration: {
    readonly wallTimeMs: number;
    readonly startedAt: string;
    readonly completedAt: string;
  };
  readonly goal: string;
  readonly outcome: "success" | "failure" | "blocked" | "cancelled" | "running";
  readonly filesChanged: {
    readonly total: number;
    readonly created: string[];
    readonly modified: string[];
    readonly deleted: string[];
  };
  readonly commandsRun: {
    readonly total: number;
    readonly highlights: string[];
  };
  readonly cost: {
    readonly totalUsd: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly backend?: Backend;
  } | null;
  readonly actions: {
    readonly total: number;
    readonly byType: Record<string, number>;
  };
  readonly policyResults: {
    readonly total: number;
    readonly passed: number;
    readonly violated: number;
    readonly violations: string[];
  };
  readonly score: {
    readonly recommendation: string;
    readonly correctness: number;
    readonly regressionRisk: number;
    readonly scopeRisk: number;
    readonly policyCompliance: number;
  } | null;
  readonly agents: {
    readonly total: number;
    readonly types: string[];
    readonly timeline: AgentTimeline;
  } | null;
  readonly headline: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapOutcome(status: RunStatus): SessionSummary["outcome"] {
  switch (status) {
    case RunStatus.Completed:
      return "success";
    case RunStatus.Failed:
      return "failure";
    case RunStatus.Blocked:
      return "blocked";
    case RunStatus.Cancelled:
      return "cancelled";
    default:
      return "running";
  }
}

const TRIVIAL_COMMANDS = new Set([
  "cd",
  "ls",
  "pwd",
  "echo",
  "cat",
  "clear",
  "true",
  "false",
  "exit",
]);

function isTrivialCommand(cmd: string): boolean {
  const base = cmd.trim().split(/\s+/)[0] ?? "";
  return TRIVIAL_COMMANDS.has(base);
}

function categorizeFiles(run: Run): SessionSummary["filesChanged"] {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const seen = new Set<string>();

  for (const action of run.actions) {
    for (const edit of action.fileEdits) {
      if (seen.has(edit.path)) continue;
      seen.add(edit.path);

      const diff = edit.diff;
      if (/^--- \/dev\/null/m.test(diff) || /^new file mode/m.test(diff)) {
        // Unified/git diff for a brand-new file (old side is /dev/null).
        created.push(edit.path);
      } else if (/^\+\+\+ \/dev\/null/m.test(diff) || /^deleted file mode/m.test(diff)) {
        // Unified/git diff for a removed file (new side is /dev/null).
        deleted.push(edit.path);
      } else if (diff.startsWith("+") && !diff.includes("-")) {
        // Simple all-additions snippet (no headers) => likely a new file.
        created.push(edit.path);
      } else if (diff.startsWith("-") && !diff.includes("+")) {
        // Simple all-removals snippet => likely a deletion.
        deleted.push(edit.path);
      } else {
        // Mixed +/- (or empty diff, as the hook/CLI producers emit) => modified.
        modified.push(edit.path);
      }
    }
  }

  return {
    total: seen.size,
    created,
    modified,
    deleted,
  };
}

function extractCommands(run: Run): SessionSummary["commandsRun"] {
  const allCommands: string[] = [];

  for (const action of run.actions) {
    for (const cmd of action.commands) {
      allCommands.push(cmd.command);
    }
  }

  const highlights = allCommands
    .filter((cmd) => !isTrivialCommand(cmd))
    .slice(0, 5);

  return {
    total: allCommands.length,
    highlights,
  };
}

function countActionsByType(run: Run): SessionSummary["actions"] {
  const byType: Record<string, number> = {};
  let total = 0;

  for (const action of run.actions) {
    if (action.fileEdits.length > 0) {
      byType["FileEdit"] = (byType["FileEdit"] ?? 0) + action.fileEdits.length;
      total += action.fileEdits.length;
    }
    if (action.commands.length > 0) {
      byType["CommandRun"] = (byType["CommandRun"] ?? 0) + action.commands.length;
      total += action.commands.length;
    }
    if (action.toolCalls.length > 0) {
      byType["ToolCall"] = (byType["ToolCall"] ?? 0) + action.toolCalls.length;
      total += action.toolCalls.length;
    }
  }

  return { total, byType };
}

function extractCost(
  metrics?: Metrics,
  backend?: Backend,
): SessionSummary["cost"] {
  if (!metrics || metrics.costUsd === 0) return null;
  return {
    totalUsd: metrics.costUsd,
    inputTokens: metrics.tokenUsage.input,
    outputTokens: metrics.tokenUsage.output,
    ...(backend ? { backend } : {}),
  };
}

function extractPolicyResults(
  policyResults?: ReadonlyArray<PolicyResult>,
): SessionSummary["policyResults"] {
  if (!policyResults || policyResults.length === 0) {
    return { total: 0, passed: 0, violated: 0, violations: [] };
  }

  const passed = policyResults.filter((r) => r.passed).length;
  const violated = policyResults.length - passed;
  const violations = policyResults
    .filter((r) => !r.passed)
    .map((r) => r.message);

  return { total: policyResults.length, passed, violated, violations };
}

function extractScore(score?: ScoreCard): SessionSummary["score"] {
  if (!score) return null;
  return {
    recommendation: score.mergeRecommendation,
    correctness: score.correctness.score,
    regressionRisk: score.regressionRisk.score,
    scopeRisk: score.scopeRisk.score,
    policyCompliance: score.policyCompliance.score,
  };
}

function getTestStatus(run: Run): string {
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length === 0) return "no tests";
  const passing = allTests.filter((t) => t.passed).length;
  if (passing === allTests.length) return "tests pass";
  return `${allTests.length - passing}/${allTests.length} failing`;
}

function formatCostShort(cost: SessionSummary["cost"]): string | null {
  if (!cost) return null;
  if (cost.totalUsd < 0.01) return "<$0.01";
  return `$${cost.totalUsd.toFixed(2)}`;
}

function generateHeadline(
  goal: string,
  filesChanged: SessionSummary["filesChanged"],
  testStatus: string,
  cost: SessionSummary["cost"],
  agentCount?: number,
): string {
  const goalShort = goal.length > 40 ? goal.slice(0, 37) + "..." : goal;
  const agentStr = agentCount !== undefined && agentCount > 1
    ? `${agentCount} agents, `
    : "";
  const fileStr =
    filesChanged.total === 1
      ? "1 file"
      : `${filesChanged.total} files`;
  const costStr = formatCostShort(cost);

  // Drop the cost segment when there's no recorded cost — "no cost" was
  // misleading (read as if the product didn't track cost). With cost
  // present, the headline keeps it as the rightmost segment so the
  // dashboard hero stat sits where users expect.
  const segments = [`${agentStr}${fileStr}`, testStatus];
  if (costStr) segments.push(costStr);
  const headline = `${goalShort}: ${segments.join(", ")}`;
  if (headline.length > 100) {
    return headline.slice(0, 97) + "...";
  }
  return headline;
}

// ─── Generator ──────────────────────────────────────────────────────────────

export function generateSummary(
  run: Run,
  metrics?: Metrics,
  policyResults?: ReadonlyArray<PolicyResult>,
  score?: ScoreCard,
  agentTimeline?: AgentTimeline,
  backend?: Backend,
): SessionSummary {
  const effectiveMetrics = metrics ?? run.metrics;
  const filesChanged = categorizeFiles(run);
  const commandsRun = extractCommands(run);
  const cost = extractCost(effectiveMetrics, backend);
  const testStatus = getTestStatus(run);

  const agents = agentTimeline
    ? {
        total: agentTimeline.totalAgents,
        types: [...new Set(agentTimeline.agents.map((a) => a.agentType))],
        timeline: agentTimeline,
      }
    : null;

  const agentCount = agentTimeline?.totalAgents;

  return {
    runId: run.id,
    generatedAt: new Date().toISOString(),
    duration: {
      wallTimeMs: effectiveMetrics.wallTimeMs,
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
    },
    goal: run.goal.humanReadable,
    outcome: mapOutcome(run.status as RunStatus),
    filesChanged,
    commandsRun,
    cost,
    actions: countActionsByType(run),
    policyResults: extractPolicyResults(policyResults),
    score: extractScore(score),
    agents,
    headline: generateHeadline(run.goal.humanReadable, filesChanged, testStatus, cost, agentCount),
  };
}
