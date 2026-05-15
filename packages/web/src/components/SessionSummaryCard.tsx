"use client";

import type { Run, SessionSummary } from "@agentops/core";
import { StatusBadge } from "./StatusBadge";
import { TimeAgo } from "./TimeAgo";
import { UserChip, type UserSummary } from "./UserChip";

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
  if (usd < 0.01) return "<$0.01";
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const outcomeColors: Record<string, string> = {
  success: "bg-green/15 text-green border-green/30",
  failure: "bg-red/15 text-red border-red/30",
  blocked: "bg-yellow/15 text-yellow border-yellow/30",
  cancelled: "bg-orange/15 text-orange border-orange/30",
  running: "bg-blue/15 text-blue border-blue/30",
};

const recommendationColors: Record<string, string> = {
  Merge: "bg-green/15 text-green border-green/30",
  Review: "bg-yellow/15 text-yellow border-yellow/30",
  Block: "bg-red/15 text-red border-red/30",
};

export function SessionSummaryCard({
  run,
  summary,
  user,
  isHighlighted,
  isSelected,
  onClick,
}: {
  run: Run;
  summary: SessionSummary;
  user?: UserSummary | null;
  isHighlighted?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const outcomeColor = outcomeColors[summary.outcome] ?? outcomeColors["running"]!;
  const recColor = summary.score
    ? recommendationColors[summary.score.recommendation] ?? "bg-muted/15 text-muted border-muted/30"
    : null;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-2 ${
        isSelected
          ? "ring-1 ring-inset ring-accent/20 bg-accent/5"
          : isHighlighted
            ? "bg-accent/5"
            : ""
      }`}
      style={{ transition: "background-color 0.5s ease-in-out" }}
    >
      {/* Headline */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {summary.headline}
      </p>

      {/* Badges row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${outcomeColor}`}
        >
          {summary.outcome}
        </span>
        {recColor && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${recColor}`}
          >
            {summary.score!.recommendation}
          </span>
        )}
        <StatusBadge status={run.status} />
        {run.github?.pr && (
          <a
            href={run.github.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-accent hover:border-accent transition-colors"
            title={`PR #${run.github.pr.number}: ${run.github.pr.title}`}
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
            </svg>
            #{run.github.pr.number}
          </a>
        )}
      </div>

      {/* Metrics row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {summary.cost && (
          <span>
            <span className="text-muted/70">Cost</span>{" "}
            <span className="font-mono text-foreground">
              {formatCost(summary.cost.totalUsd)}
            </span>
          </span>
        )}
        <span>
          <span className="text-muted/70">Duration</span>{" "}
          <span className="font-mono text-foreground">
            {formatDuration(summary.duration.wallTimeMs)}
          </span>
        </span>
        <span>
          <span className="text-muted/70">Files</span>{" "}
          <span className="font-mono text-foreground">
            {summary.filesChanged.total}
          </span>
        </span>
        <span>
          <span className="text-muted/70">Actions</span>{" "}
          <span className="font-mono text-foreground">
            {summary.actions.total}
          </span>
        </span>
      </div>

      {/* Repo/branch + user + timestamp */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono">{run.environment.repo}</span>
        <span className="font-mono">{run.environment.branch}</span>
        {user !== undefined && <UserChip user={user} compact />}
        <span className="ml-auto">
          <TimeAgo date={run.createdAt} />
        </span>
      </div>
    </div>
  );
}

/** Fallback card for runs without summaries */
export function RunFallbackCard({
  run,
  user,
  isHighlighted,
  isSelected,
  onClick,
}: {
  run: Run;
  user?: UserSummary | null;
  isHighlighted?: boolean;
  isSelected?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-2 ${
        isSelected
          ? "ring-1 ring-inset ring-accent/20 bg-accent/5"
          : isHighlighted
            ? "bg-accent/5"
            : ""
      }`}
      style={{ transition: "background-color 0.5s ease-in-out" }}
    >
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {run.goal.humanReadable}
        </p>
        <StatusBadge status={run.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-mono">{run.environment.repo}</span>
        <span className="font-mono">{run.environment.branch}</span>
        <span className="font-mono">{formatDuration(run.metrics.wallTimeMs)}</span>
        {run.metrics.costUsd > 0 && (
          <span className="font-mono">{formatCost(run.metrics.costUsd)}</span>
        )}
        {user !== undefined && <UserChip user={user} compact />}
        <span className="ml-auto">
          <TimeAgo date={run.createdAt} />
        </span>
      </div>
    </div>
  );
}
