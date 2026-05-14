"use client";

import type { SessionSummary } from "@agentops/core";
import { MetricCard } from "./MetricCard";
import { ScoreBar } from "./ScoreBar";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

const outcomeColors: Record<string, string> = {
  success: "bg-green/15 text-green border-green/30",
  failure: "bg-red/15 text-red border-red/30",
  blocked: "bg-yellow/15 text-yellow border-yellow/30",
  cancelled: "bg-orange/15 text-orange border-orange/30",
  running: "bg-blue/15 text-blue border-blue/30",
};

const recommendationColors: Record<string, string> = {
  merge: "bg-green/15 text-green border-green/30",
  review: "bg-yellow/15 text-yellow border-yellow/30",
  block: "bg-red/15 text-red border-red/30",
};

export function SummaryTab({
  summary,
  onViewActions,
}: {
  summary: SessionSummary;
  onViewActions: () => void;
}) {
  const outcomeColor = outcomeColors[summary.outcome] ?? outcomeColors["running"]!;
  const recColor = summary.score
    ? recommendationColors[summary.score.recommendation] ?? "bg-muted/15 text-muted border-muted/30"
    : null;

  return (
    <div className="space-y-6">
      {/* Headline + outcome/score */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-lg font-semibold text-foreground leading-snug">
          {summary.headline}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${outcomeColor}`}
          >
            {summary.outcome}
          </span>
          {recColor && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${recColor}`}
            >
              {summary.score!.recommendation}
            </span>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Duration"
          value={formatDuration(summary.duration.wallTimeMs)}
        />
        <MetricCard
          label="Files Changed"
          value={String(summary.filesChanged.total)}
          sub={[
            summary.filesChanged.created.length > 0 ? `${summary.filesChanged.created.length} created` : null,
            summary.filesChanged.modified.length > 0 ? `${summary.filesChanged.modified.length} modified` : null,
            summary.filesChanged.deleted.length > 0 ? `${summary.filesChanged.deleted.length} deleted` : null,
          ].filter(Boolean).join(", ") || undefined}
        />
        <MetricCard
          label="Actions"
          value={String(summary.actions.total)}
          sub={Object.entries(summary.actions.byType).map(([k, v]) => `${v} ${k}`).join(", ") || undefined}
        />
      </div>

      {/* Score bars */}
      {summary.score && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Score Card
          </h3>
          <div className="space-y-3">
            <ScoreBar
              label="Scope Risk"
              score={1 - summary.score.scopeRisk}
              rationale={`${Math.round(summary.score.scopeRisk * 100)}% risk`}
            />
            <ScoreBar
              label="Policy Compliance"
              score={summary.score.policyCompliance}
              rationale={`${Math.round(summary.score.policyCompliance * 100)}%`}
            />
          </div>
        </div>
      )}

      {/* Files changed */}
      {summary.filesChanged.total > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Files Changed
          </h3>
          <div className="space-y-2">
            {summary.filesChanged.created.length > 0 && (
              <div>
                <p className="text-xs font-medium text-green mb-1">
                  Created ({summary.filesChanged.created.length})
                </p>
                {summary.filesChanged.created.map((f) => (
                  <p key={f} className="font-mono text-xs text-muted pl-2">{f}</p>
                ))}
              </div>
            )}
            {summary.filesChanged.modified.length > 0 && (
              <div>
                <p className="text-xs font-medium text-yellow mb-1">
                  Modified ({summary.filesChanged.modified.length})
                </p>
                {summary.filesChanged.modified.map((f) => (
                  <p key={f} className="font-mono text-xs text-muted pl-2">{f}</p>
                ))}
              </div>
            )}
            {summary.filesChanged.deleted.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red mb-1">
                  Deleted ({summary.filesChanged.deleted.length})
                </p>
                {summary.filesChanged.deleted.map((f) => (
                  <p key={f} className="font-mono text-xs text-muted pl-2">{f}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commands run */}
      {summary.commandsRun.highlights.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Commands Run ({summary.commandsRun.total} total)
          </h3>
          <div className="space-y-1">
            {summary.commandsRun.highlights.map((cmd, i) => (
              <pre
                key={i}
                className="rounded bg-surface-2 px-3 py-1.5 font-mono text-xs text-foreground"
              >
                {cmd}
              </pre>
            ))}
          </div>
        </div>
      )}

      {/* Policy compliance */}
      {summary.policyResults.total > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Policy Compliance
          </h3>
          <div className="flex items-center gap-4 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green">
              <span className="h-2 w-2 rounded-full bg-green" />
              {summary.policyResults.passed} passed
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red">
              <span className="h-2 w-2 rounded-full bg-red" />
              {summary.policyResults.violated} violated
            </span>
          </div>
          {summary.policyResults.violations.length > 0 && (
            <div className="space-y-1">
              {summary.policyResults.violations.map((v, i) => (
                <p key={i} className="text-xs text-red/80 pl-2 border-l-2 border-red/30">
                  {v}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Duration info */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Timeline
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Started</span>
            <span className="font-mono text-xs text-foreground">
              {new Date(summary.duration.startedAt).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Completed</span>
            <span className="font-mono text-xs text-foreground">
              {new Date(summary.duration.completedAt).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-foreground font-medium">Wall Time</span>
            <span className="font-mono text-foreground">
              {formatDuration(summary.duration.wallTimeMs)}
            </span>
          </div>
        </div>
      </div>

      {/* Link to raw actions */}
      <div className="flex justify-center">
        <button
          onClick={onViewActions}
          className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          View raw actions
        </button>
      </div>
    </div>
  );
}
