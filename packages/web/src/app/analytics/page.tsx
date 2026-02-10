import type { Metadata } from "next";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Aggregate metrics and cost analysis across all agent runs",
};

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const runs = listRuns(db(), { limit: 1000 });

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Build cost data
  const dailyCost = new Map<string, number>();
  const dailyCounts = new Map<string, { completed: number; failed: number }>();
  const repoCounts = new Map<string, { count: number; totalCost: number }>();

  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyCost.set(key, 0);
    dailyCounts.set(key, { completed: 0, failed: 0 });
  }

  for (const run of runs) {
    const created = new Date(run.createdAt);
    const repo = run.environment.repo;
    const repoEntry = repoCounts.get(repo) ?? { count: 0, totalCost: 0 };
    repoEntry.count++;
    repoEntry.totalCost += run.metrics.costUsd;
    repoCounts.set(repo, repoEntry);

    if (created >= thirtyDaysAgo) {
      const key = created.toISOString().slice(0, 10);
      dailyCost.set(key, (dailyCost.get(key) ?? 0) + run.metrics.costUsd);

      const entry = dailyCounts.get(key) ?? { completed: 0, failed: 0 };
      if (run.status === "completed") entry.completed++;
      else if (run.status === "failed") entry.failed++;
      dailyCounts.set(key, entry);
    }
  }

  const costData = Array.from(dailyCost.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cost]) => ({ date, cost: Math.round(cost * 100) / 100 }));

  const successData = Array.from(dailyCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  const topRepos = Array.from(repoCounts.entries())
    .map(([repo, stats]) => ({
      repo,
      count: stats.count,
      totalCost: Math.round(stats.totalCost * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Most expensive runs
  const expensiveRuns = [...runs]
    .sort((a, b) => b.metrics.costUsd - a.metrics.costUsd)
    .slice(0, 10)
    .map((r) => ({
      id: r.id as string,
      goal: r.goal.humanReadable,
      status: r.status,
      repo: r.environment.repo,
      cost: r.metrics.costUsd,
      duration: r.metrics.wallTimeMs,
    }));

  // Summary stats
  const totalCost = runs.reduce((s, r) => s + r.metrics.costUsd, 0);
  const totalCompleted = runs.filter((r) => r.status === "completed").length;
  const totalFailed = runs.filter((r) => r.status === "failed").length;
  const avgDuration =
    runs.length > 0
      ? runs.reduce((s, r) => s + r.metrics.wallTimeMs, 0) / runs.length
      : 0;

  if (runs.length === 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
          <p className="text-sm text-muted">Aggregate metrics across all runs</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <div className="text-4xl text-muted mb-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="24" width="9" height="18" rx="1.5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
              <rect x="19.5" y="15" width="9" height="27" rx="1.5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
              <rect x="33" y="6" width="9" height="36" rx="1.5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">Not enough data</p>
          <p className="text-xs text-muted mt-1">
            Run some agents to see analytics here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AnalyticsDashboard
      costData={costData}
      successData={successData}
      topRepos={topRepos}
      expensiveRuns={expensiveRuns}
      totalRuns={runs.length}
      totalCost={totalCost}
      totalCompleted={totalCompleted}
      totalFailed={totalFailed}
      avgDuration={avgDuration}
    />
  );
}
