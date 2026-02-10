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
          label="Active Jobs"
          value={String(activeJobs)}
          sub={`${stats.jobs.queued}q / ${stats.jobs.dispatched}d / ${stats.jobs.running}r`}
        />
        <MetricCard
          label="Sessions"
          value={String(stats.sessions.active)}
          sub="active"
        />
        <MetricCard
          label="Events (24h)"
          value={String(stats.events.last24h)}
          sub={`${stats.events.lastHour} last hour`}
        />
        <MetricCard
          label="Locks"
          value={String(stats.locks.active)}
          sub="active"
        />
      </div>

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
