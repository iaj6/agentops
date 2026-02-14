"use client";

import type { ReactNode } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useStats } from "@/hooks/useStats";

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

export function FleetOverview({ children }: { children: ReactNode }) {
  const { stats, loading } = useStats();

  if (loading || !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-[88px] animate-pulse rounded-lg border border-border bg-surface"
            />
          ))}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    );
  }

  const activeJobs = stats.jobs.queued + stats.jobs.dispatched + stats.jobs.running;

  return (
    <div className="space-y-6">
      {/* Row 1: Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <MetricCard label="Total Runs" value={String(stats.runs.total)} />
        <MetricCard
          label="Running Now"
          value={String(stats.runs.running)}
        />
        <MetricCard
          label="Success Rate"
          value={`${stats.runs.successRate}%`}
        />
        <MetricCard label="Total Cost" value={formatCost(stats.runs.totalCost)} />
        <MetricCard
          label="Today"
          value={String(stats.summary.runsToday)}
          sub={`${formatCost(stats.summary.costToday)} spent`}
        />
        <MetricCard
          label="This Week"
          value={String(stats.summary.runsThisWeek)}
          sub={`${formatCost(stats.summary.costThisWeek)} spent`}
        />
        <MetricCard
          label="Events (24h)"
          value={String(stats.events.last24h)}
          sub={`${stats.events.lastHour} last hour`}
        />
        <MetricCard
          label="Active Jobs"
          value={String(activeJobs)}
          sub={`${stats.sessions.active} sessions`}
        />
      </div>

      {/* Row 1.5: Top repos (if any) */}
      {stats.summary.topRepos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Most Active Repos (This Week)
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.summary.topRepos.map(({ repo, count }) => (
              <span
                key={repo}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs"
              >
                <span className="font-mono text-foreground">{repo}</span>
                <span className="text-muted">{count} runs</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Row 2: Runs table (left) + Activity feed (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">
            Recent Runs
          </h2>
          {children}
        </div>
        <div>
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
