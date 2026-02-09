"use client";

import { useState } from "react";
import type { Run } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricCard } from "@/components/MetricCard";
import { ScoreBar } from "@/components/ScoreBar";
import Link from "next/link";

type Tab = "overview" | "actions" | "artifacts" | "metrics" | "policy" | "decision";

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

export function RunDetail({ run }: { run: Run }) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "actions", label: "Actions" },
    { key: "artifacts", label: "Artifacts" },
    { key: "metrics", label: "Metrics" },
    { key: "policy", label: "Policy" },
    { key: "decision", label: "Decision" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2">
          <Link
            href="/"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Runs
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold text-foreground">
            {(run.id as string).slice(0, 12)}
          </h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm text-foreground">{run.goal.humanReadable}</p>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted">
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
      <div className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
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
    </div>
  );
}

function OverviewTab({ run }: { run: Run }) {
  return (
    <div className="space-y-6">
      {/* Quick metrics */}
      <div className="grid grid-cols-4 gap-4">
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
          <div className="space-y-3">
            {run.evaluations.map((evaluation, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-foreground">
                    Confidence: {(evaluation.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {evaluation.testResults.map((test, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${test.passed ? "bg-green" : "bg-red"}`}
                      />
                      <span className="text-foreground">{test.name}</span>
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

  return (
    <div className="space-y-4">
      {run.actions.map((action, i) => (
        <div key={action.id as string} className="rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
              Action {i + 1}
            </span>
            <span className="text-xs text-muted">
              {new Date(action.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Tool calls */}
          {action.toolCalls.length > 0 && (
            <div className="border-b border-border p-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Tool Calls ({action.toolCalls.length})
              </h4>
              <div className="space-y-2">
                {action.toolCalls.map((tc, j) => (
                  <div key={j} className="rounded bg-surface-2 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-cyan">{tc.name}</span>
                      <span className="text-xs text-muted">
                        {new Date(tc.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="mt-1 overflow-x-auto text-xs text-muted">
                      {JSON.stringify(tc.input, null, 2)}
                    </pre>
                    {tc.output && (
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-foreground">
                        {tc.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File edits */}
          {action.fileEdits.length > 0 && (
            <div className="border-b border-border p-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                File Edits ({action.fileEdits.length})
              </h4>
              <div className="space-y-2">
                {action.fileEdits.map((edit, j) => (
                  <div key={j} className="rounded bg-surface-2 p-3">
                    <div className="font-mono text-sm text-orange">{edit.path}</div>
                    <pre className="mt-1 max-h-60 overflow-auto rounded bg-background p-2 text-xs text-foreground">
                      {edit.diff}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commands */}
          {action.commands.length > 0 && (
            <div className="p-4">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Commands ({action.commands.length})
              </h4>
              <div className="space-y-2">
                {action.commands.map((cmd, j) => (
                  <div key={j} className="rounded bg-surface-2 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-foreground">
                        $ {cmd.command}
                      </span>
                      <span
                        className={`ml-auto rounded px-1.5 py-0.5 text-xs font-mono ${
                          cmd.exitCode === 0
                            ? "bg-green/15 text-green"
                            : "bg-red/15 text-red"
                        }`}
                      >
                        exit {cmd.exitCode}
                      </span>
                    </div>
                    {cmd.stdout && (
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-green/80">
                        {cmd.stdout}
                      </pre>
                    )}
                    {cmd.stderr && (
                      <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-red/80">
                        {cmd.stderr}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
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
                  <pre
                    key={i}
                    className="mb-2 max-h-60 overflow-auto rounded bg-surface-2 p-3 text-xs text-foreground font-mono"
                  >
                    {diff}
                  </pre>
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
      <div className="grid grid-cols-4 gap-4">
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

      <div className="grid grid-cols-2 gap-4">
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

  return (
    <div className="space-y-3">
      {policyChecks.map((check, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              check.passed
                ? "bg-green/15 text-green"
                : "bg-red/15 text-red"
            }`}
          >
            {check.passed ? "\u2713" : "\u2717"}
          </span>
          <div className="flex-1">
            <span className="text-sm font-mono text-foreground">
              {check.policyId as string}
            </span>
            <p className="text-xs text-muted">{check.message}</p>
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
      ))}
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
