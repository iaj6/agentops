"use client";

import { useState } from "react";
import type { Run } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { ScoreBar } from "@/components/ScoreBar";
import { DiffViewer } from "@/components/DiffViewer";
import { ActionTimeline } from "@/components/ActionTimeline";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useRunDetail } from "@/hooks/useRunDetail";
import Link from "next/link";

type Tab = "overview" | "actions" | "artifacts" | "metrics" | "policy" | "decision" | "github";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function RunDetail({ run: initialRun }: { run: Run }) {
  const { run: liveRun, connected } = useRunDetail(
    initialRun.id as string,
    initialRun,
  );
  const run = liveRun ?? initialRun;
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "actions", label: "Actions" },
    { key: "artifacts", label: "Artifacts" },
    { key: "metrics", label: "Metrics" },
    { key: "policy", label: "Policy" },
    { key: "decision", label: "Decision" },
    { key: "github", label: "GitHub" },
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
            {(run.id as string).slice(0, 12)}
          </h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm text-foreground">{run.goal.humanReadable}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <span className="text-muted/70">Repo</span>{" "}
            <span className="font-mono">{run.environment.repo}</span>
          </span>
          <span>
            <span className="text-muted/70">Branch</span>{" "}
            <span className="font-mono">{run.environment.branch}</span>
          </span>
          <span>
            <span className="text-muted/70">Created</span>{" "}
            {new Date(run.createdAt).toLocaleString()}
          </span>
          <span>
            <span className="text-muted/70">Updated</span>{" "}
            {new Date(run.updatedAt).toLocaleString()}
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
      {tab === "overview" && <OverviewTab run={run} />}
      {tab === "actions" && <ActionsTab run={run} />}
      {tab === "artifacts" && <ArtifactsTab run={run} />}
      {tab === "metrics" && <MetricsTab run={run} />}
      {tab === "policy" && <PolicyTab run={run} />}
      {tab === "decision" && <DecisionTab run={run} />}
      {tab === "github" && <GitHubTab run={run} />}
    </div>
  );
}

function OverviewTab({ run }: { run: Run }) {
  return (
    <div className="space-y-6">
      {/* Quick metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Cost"
          value={formatCost(run.metrics.costUsd)}
        />
        <MetricCard
          label="Duration"
          value={formatDuration(run.metrics.wallTimeMs)}
        />
        <MetricCard
          label="Tokens"
          value={formatTokens(run.metrics.tokenUsage.total)}
          sub={`${formatTokens(run.metrics.tokenUsage.input)} in / ${formatTokens(run.metrics.tokenUsage.output)} out`}
        />
        <MetricCard
          label="Agents"
          value={String(run.agents.length)}
        />
      </div>

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

      {/* Agents */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Agents
        </h3>
        <div className="space-y-2">
          {run.agents.map((agent) => (
            <div
              key={agent.id as string}
              className="flex items-center gap-3 rounded bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                {agent.role}
              </span>
              <span className="font-mono text-xs text-muted">{agent.model}</span>
              <span className="ml-auto font-mono text-xs text-muted/60">
                {(agent.id as string).slice(0, 8)}
              </span>
            </div>
          ))}
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

function MetricsTab({ run }: { run: Run }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Cost"
          value={formatCost(run.metrics.costUsd)}
        />
        <MetricCard
          label="Wall Time"
          value={formatDuration(run.metrics.wallTimeMs)}
        />
        <MetricCard
          label="Total Tokens"
          value={formatTokens(run.metrics.tokenUsage.total)}
        />
        <MetricCard
          label="Flake Rate"
          value={`${(run.metrics.flakeRate * 100).toFixed(1)}%`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Token Breakdown
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Input tokens</span>
              <span className="font-mono text-foreground">
                {run.metrics.tokenUsage.input.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Output tokens</span>
              <span className="font-mono text-foreground">
                {run.metrics.tokenUsage.output.toLocaleString()}
              </span>
            </div>
            <div className="border-t border-border pt-2 flex items-center justify-between text-sm font-medium">
              <span className="text-foreground">Total</span>
              <span className="font-mono text-foreground">
                {run.metrics.tokenUsage.total.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Activity Summary
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Actions</span>
              <span className="font-mono text-foreground">
                {run.actions.length}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Tool calls</span>
              <span className="font-mono text-foreground">
                {run.actions.reduce((sum, a) => sum + a.toolCalls.length, 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">File edits</span>
              <span className="font-mono text-foreground">
                {run.actions.reduce((sum, a) => sum + a.fileEdits.length, 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Commands</span>
              <span className="font-mono text-foreground">
                {run.actions.reduce((sum, a) => sum + a.commands.length, 0)}
              </span>
            </div>
          </div>
        </div>
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

function DecisionTab({ run }: { run: Run }) {
  if (run.decisions.length === 0) {
    return <EmptyState message="No decisions recorded for this run." />;
  }

  const typeColors: Record<string, string> = {
    approval: "bg-green/15 text-green",
    block: "bg-red/15 text-red",
    escalation: "bg-yellow/15 text-yellow",
  };

  return (
    <div className="space-y-3">
      {run.decisions.map((decision) => (
        <div
          key={decision.id as string}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex items-center gap-3 mb-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[decision.type] ?? "bg-muted/15 text-muted"}`}
            >
              {decision.type.toUpperCase()}
            </span>
            <span className="text-sm font-medium text-foreground">
              {decision.actor}
            </span>
            <span className="ml-auto text-xs text-muted">
              {new Date(decision.timestamp).toLocaleString()}
            </span>
          </div>
          <p className="text-sm text-muted">{decision.reason}</p>
        </div>
      ))}
    </div>
  );
}

function GitHubTab({ run }: { run: Run }) {
  const gh = run.github;

  if (!gh || (!gh.pr && !gh.issue && (!gh.checks || gh.checks.length === 0))) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted mb-2">No GitHub integration for this run.</p>
        <p className="text-xs text-muted/70">
          Use <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">agentops link pr {'<runId>'}</code> or{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">agentops pr {'<runId>'}</code> to connect GitHub.
        </p>
      </div>
    );
  }

  const checkConclusion = (conclusion: string | null) => {
    switch (conclusion) {
      case "success":
        return "bg-green/15 text-green border-green/30";
      case "failure":
        return "bg-red/15 text-red border-red/30";
      case "neutral":
      case "skipped":
        return "bg-muted/15 text-muted border-muted/30";
      default:
        return "bg-yellow/15 text-yellow border-yellow/30";
    }
  };

  return (
    <div className="space-y-6">
      {/* Linked PR */}
      {gh.pr && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Pull Request
          </h3>
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                gh.pr.state === "open"
                  ? "bg-green/15 text-green border-green/30"
                  : gh.pr.state === "merged"
                    ? "bg-purple/15 text-purple border-purple/30"
                    : "bg-red/15 text-red border-red/30"
              }`}
            >
              {gh.pr.state}
            </span>
            <div className="flex-1 min-w-0">
              <a
                href={gh.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-accent hover:underline"
              >
                #{gh.pr.number} {gh.pr.title}
              </a>
              <div className="mt-1 flex items-center gap-4 text-xs text-muted">
                <span>
                  <span className="font-mono">{gh.pr.headBranch}</span>
                  {" -> "}
                  <span className="font-mono">{gh.pr.baseBranch}</span>
                </span>
                <span className="text-green">+{gh.pr.additions}</span>
                <span className="text-red">-{gh.pr.deletions}</span>
                <span>{gh.pr.changedFiles} file(s)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Linked Issue */}
      {gh.issue && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Issue
          </h3>
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                gh.issue.state === "open"
                  ? "bg-green/15 text-green border-green/30"
                  : "bg-red/15 text-red border-red/30"
              }`}
            >
              {gh.issue.state}
            </span>
            <div className="flex-1 min-w-0">
              <a
                href={gh.issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-accent hover:underline"
              >
                #{gh.issue.number} {gh.issue.title}
              </a>
              {gh.issue.labels.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {gh.issue.labels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Check Runs */}
      {gh.checks && gh.checks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Check Runs
          </h3>
          <div className="space-y-2">
            {gh.checks.map((check, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded bg-surface-2 px-3 py-2 text-sm"
              >
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${checkConclusion(check.conclusion)}`}
                >
                  {check.conclusion ?? check.status}
                </span>
                <span className="text-foreground">{check.name}</span>
                <span className="ml-auto text-xs text-muted">{check.status}</span>
                {check.url && (
                  <a
                    href={check.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    Details
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
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
