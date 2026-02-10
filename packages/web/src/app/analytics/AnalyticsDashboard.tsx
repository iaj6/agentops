"use client";

import { MetricCard } from "@/components/MetricCard";
import { CostChart } from "@/components/CostChart";
import { SuccessChart } from "@/components/SuccessChart";
import { StatusBadge } from "@/components/StatusBadge";
import Link from "next/link";

interface Props {
  costData: { date: string; cost: number }[];
  successData: { date: string; completed: number; failed: number }[];
  topRepos: { repo: string; count: number; totalCost: number }[];
  expensiveRuns: {
    id: string;
    goal: string;
    status: string;
    repo: string;
    cost: number;
    duration: number;
  }[];
  totalRuns: number;
  totalCost: number;
  totalCompleted: number;
  totalFailed: number;
  avgDuration: number;
}

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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

export function AnalyticsDashboard({
  costData,
  successData,
  topRepos,
  expensiveRuns,
  totalRuns,
  totalCost,
  totalCompleted,
  totalFailed,
  avgDuration,
}: Props) {
  const successRate =
    totalCompleted + totalFailed > 0
      ? ((totalCompleted / (totalCompleted + totalFailed)) * 100).toFixed(1)
      : "0";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted">Aggregate metrics across all runs</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard label="Total Runs" value={String(totalRuns)} />
        <MetricCard label="Total Cost" value={formatCost(totalCost)} />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${totalCompleted} passed / ${totalFailed} failed`}
        />
        <MetricCard label="Avg Duration" value={formatDuration(avgDuration)} />
        <MetricCard
          label="Avg Cost"
          value={formatCost(totalRuns > 0 ? totalCost / totalRuns : 0)}
          sub="per run"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CostChart data={costData} />
        <SuccessChart data={successData} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Repos */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Top Repos by Run Count
          </h3>
          <div className="space-y-2">
            {topRepos.map((repo, i) => {
              const maxCount = topRepos[0]?.count ?? 1;
              const pct = (repo.count / maxCount) * 100;
              return (
                <div key={repo.repo} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-foreground">
                      <span className="text-muted mr-2">#{i + 1}</span>
                      {repo.repo}
                    </span>
                    <span className="text-xs text-muted">
                      {repo.count} runs &middot; {formatCost(repo.totalCost)}
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-surface-2">
                    <div
                      className="h-1 rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Most Expensive Runs */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Most Expensive Runs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3">Run</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3 text-right">Cost</th>
                  <th className="pb-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {expensiveRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-border/50"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-accent hover:underline"
                      >
                        <span className="font-mono text-xs">
                          {run.id.slice(0, 8)}
                        </span>
                      </Link>
                      <p className="text-xs text-muted truncate max-w-[200px]">
                        {truncate(run.goal, 40)}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-foreground">
                      {formatCost(run.cost)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-foreground">
                      {formatDuration(run.duration)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
