"use client";

import { useState } from "react";
import type { Run, SessionSummary } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { ScoreBar } from "@/components/ScoreBar";
import { DiffViewer } from "@/components/DiffViewer";
import { ActionTimeline } from "@/components/ActionTimeline";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SummaryTab } from "@/components/SummaryTab";
import { UserChip, type UserSummary } from "@/components/UserChip";
import { StaleBadge } from "@/components/StaleBadge";
import { isStaleRun } from "@agentops/core";
import { useRunDetail } from "@/hooks/useRunDetail";
import Link from "next/link";

type Tab = "summary" | "overview" | "actions" | "artifacts" | "activity" | "policy";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function formatCost(usd: number | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatTokens(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function RunDetail({
  run: initialRun,
  initialSummary,
  owner,
}: {
  run: Run;
  initialSummary: SessionSummary | null;
  owner?: UserSummary | null;
}) {
  const { run: liveRun, summary: liveSummary, connected } = useRunDetail(
    initialRun.id as string,
    initialRun,
    initialSummary,
  );
  const run = liveRun ?? initialRun;
  const summary = liveSummary ?? initialSummary;
  const [tab, setTab] = useState<Tab>(summary ? "summary" : "overview");
  const displayRun = run;

  const tabs: { key: Tab; label: string }[] = [
    ...(summary ? [{ key: "summary" as Tab, label: "Summary" }] : []),
    { key: "overview", label: "Overview" },
    { key: "actions", label: "Actions" },
    { key: "artifacts", label: "Artifacts" },
    { key: "activity", label: "Activity" },
    { key: "policy", label: "Policy" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Runs
          </Link>
          <ConnectionStatus connected={connected} />
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold text-foreground">
            {(displayRun.id as string).slice(0, 12)}
          </h1>
          <StatusBadge status={displayRun.status} />
          {isStaleRun(displayRun) && <StaleBadge />}
          {owner !== undefined && <UserChip user={owner} />}
        </div>
        <p className="mt-1 text-sm text-foreground">{displayRun.goal.humanReadable}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <span className="text-muted/70">Repo</span>{" "}
            <span className="font-mono">{displayRun.environment.repo}</span>
          </span>
          <span>
            <span className="text-muted/70">Branch</span>{" "}
            <span className="font-mono">{displayRun.environment.branch}</span>
          </span>
          <span>
            <span className="text-muted/70">Created</span>{" "}
            {new Date(displayRun.createdAt).toLocaleString()}
          </span>
          <span>
            <span className="text-muted/70">Updated</span>{" "}
            {new Date(displayRun.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-accent text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "summary" && summary && (
        <SummaryTab summary={summary} onViewActions={() => setTab("actions")} />
      )}
      {tab === "overview" && <OverviewTab run={displayRun} />}
      {tab === "actions" && <ActionsTab run={displayRun} />}
      {tab === "artifacts" && <ArtifactsTab run={displayRun} />}
      {tab === "activity" && <ActivityTab run={displayRun} />}
      {tab === "policy" && <PolicyTab run={displayRun} />}
    </div>
  );
}

function OverviewTab({ run }: { run: Run }) {
  const totalFileEdits = run.actions.reduce((sum, a) => sum + a.fileEdits.length, 0);
  const totalToolCalls = run.actions.reduce((sum, a) => sum + a.toolCalls.length, 0);

  const tokens = run.metrics.tokenUsage;
  return (
    <div className="space-y-6">
      {/* Quick metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          label="Cost"
          value={formatCost(run.metrics.costUsd)}
          sub={tokens ? `${formatTokens(tokens.total)} tokens` : undefined}
        />
        <MetricCard
          label="Duration"
          value={formatDuration(run.metrics.wallTimeMs)}
        />
        <MetricCard
          label="Files Changed"
          value={String(totalFileEdits)}
        />
        <MetricCard
          label="Tool Calls"
          value={String(totalToolCalls)}
        />
        <MetricCard
          label="Actions"
          value={String(run.actions.length)}
        />
      </div>

      {/* Token breakdown */}
      {tokens && tokens.total > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Token Usage
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-muted">Input: </span>
              <span className="font-mono text-foreground">{formatTokens(tokens.input)}</span>
            </div>
            <div>
              <span className="text-muted">Output: </span>
              <span className="font-mono text-foreground">{formatTokens(tokens.output)}</span>
            </div>
            <div>
              <span className="text-muted">Total: </span>
              <span className="font-mono text-foreground">{formatTokens(tokens.total)}</span>
            </div>
            <div>
              <span className="text-muted">Cost: </span>
              <span className="font-mono text-foreground">{formatCost(run.metrics.costUsd)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Goal */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
          Goal
        </h3>
        <p className="text-sm text-foreground">{run.goal.humanReadable}</p>
        <div className="mt-2 rounded bg-surface-2 p-3 font-mono text-xs text-muted">
          <span className="text-accent">{run.goal.structured.type}</span>
          : {run.goal.structured.description}
        </div>
      </div>

      {/* Environment */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Environment
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted">Repo: </span>
            <span className="font-mono text-foreground">{run.environment.repo}</span>
          </div>
          <div>
            <span className="text-muted">Branch: </span>
            <span className="font-mono text-foreground">{run.environment.branch}</span>
          </div>
          <div>
            <span className="text-muted">Sandbox: </span>
            <span className="text-foreground">
              {run.environment.sandbox.enabled ? "Enabled" : "Disabled"}
              {run.environment.sandbox.enabled &&
                ` (${run.environment.sandbox.isolationLevel})`}
            </span>
          </div>
          <div>
            <span className="text-muted">Permissions: </span>
            <span className="text-foreground">
              {run.environment.permissions.join(", ") || "None"}
            </span>
          </div>
        </div>
      </div>

      {/* Score Card */}
      {run.evaluations.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Score Card
          </h3>
          <div className="space-y-4">
            {run.evaluations.map((evaluation, i) => (
              <div key={i}>
                <ScoreBar
                  label="Confidence"
                  score={evaluation.confidenceScore}
                  rationale={`${(evaluation.confidenceScore * 100).toFixed(0)}% confidence based on ${evaluation.testResults.length} tests`}
                />
                <div className="mt-3 space-y-1.5">
                  {evaluation.testResults.map((test, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                          test.passed
                            ? "bg-green/15 text-green border-green/30"
                            : "bg-red/15 text-red border-red/30"
                        }`}
                      >
                        {test.passed ? "PASS" : "FAIL"}
                      </span>
                      <span className="text-foreground">{test.name}</span>
                      {test.message && (
                        <span className="text-muted truncate max-w-[300px]">{test.message}</span>
                      )}
                      <span className="ml-auto font-mono text-muted">
                        {test.duration}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionsTab({ run }: { run: Run }) {
  if (run.actions.length === 0) {
    return <EmptyState message="No actions recorded for this run." />;
  }

  return <ActionTimeline actions={run.actions} />;
}

function ArtifactsTab({ run }: { run: Run }) {
  if (run.artifacts.length === 0) {
    return <EmptyState message="No artifacts for this run." />;
  }

  return (
    <div className="space-y-4">
      {run.artifacts.map((artifact) => (
        <div
          key={artifact.id as string}
          className="rounded-lg border border-border bg-surface"
        >
          <div className="border-b border-border px-4 py-3">
            <span className="font-mono text-sm text-foreground">
              {(artifact.id as string).slice(0, 8)}
            </span>
          </div>
          <div className="p-4 space-y-4">
            {artifact.diffs.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Diffs ({artifact.diffs.length})
                </h4>
                {artifact.diffs.map((diff, i) => (
                  <div key={i} className="mb-3">
                    <DiffViewer diff={diff} />
                  </div>
                ))}
              </div>
            )}
            {artifact.logs.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Logs ({artifact.logs.length})
                </h4>
                {artifact.logs.map((log, i) => (
                  <pre
                    key={i}
                    className="mb-2 max-h-60 overflow-auto rounded bg-surface-2 p-3 text-xs text-foreground font-mono"
                  >
                    {log}
                  </pre>
                ))}
              </div>
            )}
            {artifact.testOutputs.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Test Outputs ({artifact.testOutputs.length})
                </h4>
                {artifact.testOutputs.map((output, i) => (
                  <pre
                    key={i}
                    className="mb-2 max-h-60 overflow-auto rounded bg-surface-2 p-3 text-xs text-foreground font-mono"
                  >
                    {output}
                  </pre>
                ))}
              </div>
            )}
            {artifact.reports.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Reports ({artifact.reports.length})
                </h4>
                {artifact.reports.map((report, i) => (
                  <pre
                    key={i}
                    className="mb-2 max-h-60 overflow-auto rounded bg-surface-2 p-3 text-xs text-foreground font-mono"
                  >
                    {report}
                  </pre>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ run }: { run: Run }) {
  const totalActions = run.actions.length;
  const allToolCalls = run.actions.flatMap((a) => a.toolCalls);
  const totalToolCalls = allToolCalls.length;
  const totalFileEdits = run.actions.reduce((sum, a) => sum + a.fileEdits.length, 0);
  const allCommands = run.actions.flatMap((a) => a.commands);
  const totalCommands = allCommands.length;
  const successCommands = allCommands.filter((c) => c.exitCode === 0).length;
  const failedCommands = totalCommands - successCommands;

  // Build tool call breakdown by name
  const toolBreakdown: Record<string, number> = {};
  for (const tc of allToolCalls) {
    toolBreakdown[tc.name] = (toolBreakdown[tc.name] ?? 0) + 1;
  }
  const sortedTools = Object.entries(toolBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      {/* Summary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          label="Cost"
          value={formatCost(run.metrics.costUsd)}
          sub={run.metrics.tokenUsage ? `${formatTokens(run.metrics.tokenUsage.total)} tokens` : undefined}
        />
        <MetricCard
          label="Duration"
          value={formatDuration(run.metrics.wallTimeMs)}
        />
        <MetricCard
          label="Actions"
          value={String(totalActions)}
        />
        <MetricCard
          label="Tool Calls"
          value={String(totalToolCalls)}
        />
        <MetricCard
          label="File Edits"
          value={String(totalFileEdits)}
        />
        <MetricCard
          label="Commands"
          value={String(totalCommands)}
          sub={`${successCommands} ok / ${failedCommands} failed`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tool call breakdown */}
        {sortedTools.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Tool Calls by Name
            </h3>
            <div className="space-y-2">
              {sortedTools.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-foreground">{name}</span>
                  <span className="font-mono text-muted">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Command results */}
        {totalCommands > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Command Results
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Succeeded (exit 0)</span>
                <span className="font-mono text-green">{successCommands}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Failed (non-zero exit)</span>
                <span className="font-mono text-red">{failedCommands}</span>
              </div>
              <div className="border-t border-border pt-2 flex items-center justify-between text-sm font-medium">
                <span className="text-foreground">Total</span>
                <span className="font-mono text-foreground">{totalCommands}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PolicyTab({ run }: { run: Run }) {
  const policyChecks = run.evaluations.flatMap((e) => e.policyChecks);

  if (policyChecks.length === 0) {
    return <EmptyState message="No policy results for this run." />;
  }

  const passCount = policyChecks.filter((c) => c.passed).length;
  const failCount = policyChecks.length - passCount;

  // Infer severity from policy naming convention
  function inferSeverity(policyId: string): string {
    if (policyId.includes("risky") || policyId.includes("flag") || policyId.includes("deploy")) return "warning";
    if (policyId.includes("info")) return "info";
    return "error";
  }

  const severityStyles: Record<string, { border: string; bg: string; icon: string; badge: string }> = {
    error: {
      border: "border-l-red",
      bg: "bg-red/5",
      icon: "bg-red/15 text-red",
      badge: "border-red/30 bg-red/15 text-red",
    },
    warning: {
      border: "border-l-yellow",
      bg: "bg-yellow/5",
      icon: "bg-yellow/15 text-yellow",
      badge: "border-yellow/30 bg-yellow/15 text-yellow",
    },
    info: {
      border: "border-l-blue",
      bg: "bg-blue/5",
      icon: "bg-blue/15 text-blue",
      badge: "border-blue/30 bg-blue/15 text-blue",
    },
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          Policy Results
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green">
            <span className="h-2 w-2 rounded-full bg-green" />
            {passCount} passed
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red">
            <span className="h-2 w-2 rounded-full bg-red" />
            {failCount} failed
          </span>
        </div>
      </div>

      {/* Individual checks */}
      {policyChecks.map((check, i) => {
        const severity = inferSeverity(check.policyId as string);
        const styles = severityStyles[severity] ?? severityStyles["error"]!;
        const isFail = !check.passed;

        return (
          <div
            key={i}
            className={`rounded-lg border border-border border-l-4 ${isFail ? `${styles.bg} ${styles.border}` : "bg-surface border-l-green"}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  check.passed ? "bg-green/15 text-green" : styles.icon
                }`}
              >
                {check.passed ? "\u2713" : "\u2717"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/policies/${check.policyId as string}`}
                    className="text-sm font-mono text-accent hover:underline"
                  >
                    {check.policyId as string}
                  </Link>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${styles.badge}`}
                  >
                    {severity}
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">{check.message}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  check.passed
                    ? "bg-green/15 text-green border border-green/30"
                    : "bg-red/15 text-red border border-red/30"
                }`}
              >
                {check.passed ? "PASS" : "FAIL"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
