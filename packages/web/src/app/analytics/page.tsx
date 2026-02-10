import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

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
