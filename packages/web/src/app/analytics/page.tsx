import type { Metadata } from "next";
import { listRuns, listUsers } from "@agentops/db";
import { db } from "@/lib/db";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Aggregate metrics, cost rollups, and policy compliance across all agent runs",
};

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const d = db();
  const runs = listRuns(d, { limit: 1000 });

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Resolve userId → display name once; pre-auth and local-mode runs
  // (no auth context to attribute) aggregate under "unattributed". Use
  // `agentops cleanup --reassign-null-user <id>` to backfill.
  const users = listUsers(d);
  const userById = new Map<string, { email: string; name: string | null }>();
  for (const u of users) {
    userById.set(u.id, { email: u.email, name: u.name });
  }

  // Build daily success/failure counts
  const dailyCounts = new Map<string, { completed: number; failed: number }>();
  const repoCounts = new Map<string, { count: number; cost: number }>();
  const userAgg = new Map<string, { count: number; cost: number; label: string }>();

  for (let i = 0; i < 30; i++) {
    const dd = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dd.toISOString().slice(0, 10);
    dailyCounts.set(key, { completed: 0, failed: 0 });
  }

  // Rolling cost totals: all-time, plus a 30d window for the headline stat.
  let totalCostAllTime = 0;
  let totalCost30d = 0;

  for (const run of runs) {
    const created = new Date(run.createdAt);
    const repo = run.environment.repo;
    const cost = run.metrics.costUsd ?? 0;
    const repoEntry = repoCounts.get(repo) ?? { count: 0, cost: 0 };
    repoEntry.count++;
    repoEntry.cost += cost;
    repoCounts.set(repo, repoEntry);
    totalCostAllTime += cost;

    // Per-user aggregation. Runs with no userId (pre-auth or
    // local-mode hooks where there's no auth context) bucket under a
    // synthetic "unattributed" key — flagged so it's obvious the rows
    // don't belong to anyone, not just attributed to "the system".
    const userKey = run.userId ? (run.userId as string) : "__unattributed__";
    if (!userAgg.has(userKey)) {
      const resolved = run.userId ? userById.get(run.userId as string) : null;
      const label = resolved?.name ?? resolved?.email ?? "unattributed";
      userAgg.set(userKey, { count: 0, cost: 0, label });
    }
    const userEntry = userAgg.get(userKey)!;
    userEntry.count++;
    userEntry.cost += cost;

    if (created >= thirtyDaysAgo) {
      totalCost30d += cost;
      const key = created.toISOString().slice(0, 10);

      const entry = dailyCounts.get(key) ?? { completed: 0, failed: 0 };
      if (run.status === "completed") entry.completed++;
      else if (run.status === "failed") entry.failed++;
      dailyCounts.set(key, entry);
    }
  }

  const successData = Array.from(dailyCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  const topRepos = Array.from(repoCounts.entries())
    .map(([repo, stats]) => ({
      repo,
      count: stats.count,
      cost: stats.cost,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topUsers = Array.from(userAgg.values())
    .map((u) => ({ label: u.label, count: u.count, cost: u.cost }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Summary stats
  const totalCompleted = runs.filter((r) => r.status === "completed").length;
  const totalFailed = runs.filter((r) => r.status === "failed").length;

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
      successData={successData}
      topRepos={topRepos}
      topUsers={topUsers}
      totalRuns={runs.length}
      totalCompleted={totalCompleted}
      totalFailed={totalFailed}
      totalCostAllTime={totalCostAllTime}
      totalCost30d={totalCost30d}
    />
  );
}
