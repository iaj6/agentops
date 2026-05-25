"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useStats } from "@/hooks/useStats";

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function FleetOverview({ children }: { children: ReactNode }) {
  // Forward the active UserFilter scope to /api/stats so the headline
  // numbers above the runs table narrow with the chip. Without this,
  // an admin filtering to one user sees "TOTAL SPEND $572" sitting on
  // top of that user's eight rows — wrong story.
  const searchParams = useSearchParams();
  const { stats, loading } = useStats({
    view: searchParams.get("view"),
    userId: searchParams.get("userId"),
  });

  if (loading || !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
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

  return (
    <div className="space-y-6">
      {/* Row 1: Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total Spend"
          value={formatCost(stats.cost.total)}
          sub={
            stats.cost.week > 0
              ? `${formatCost(stats.cost.week)} this week`
              : undefined
          }
        />
        <MetricCard label="Total Runs" value={String(stats.runs.total)} />
        <MetricCard
          label="Running Now"
          value={String(stats.runs.running)}
          sub={stats.runs.stale > 0 ? `${stats.runs.stale} stale` : undefined}
        />
        <MetricCard
          label="Success Rate"
          value={`${stats.runs.successRate}%`}
        />
        <MetricCard
          label="Today"
          value={String(stats.summary.runsToday)}
        />
        <MetricCard
          label="This Week"
          value={String(stats.summary.runsThisWeek)}
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
