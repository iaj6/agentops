import { Suspense } from "react";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";
import { RunsTable } from "./RunsTable";
import { DashboardStats } from "./DashboardStats";

export const dynamic = "force-dynamic";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
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

export default function HomePage() {
  const runs = listRuns(db(), { limit: 50 });

  const totalRuns = runs.length;
  const running = runs.filter((r) => r.status === "running").length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const successRate =
    completed + failed > 0
      ? ((completed / (completed + failed)) * 100).toFixed(1)
      : "0";
  const totalCost = runs.reduce((s, r) => s + r.metrics.costUsd, 0);
  const avgDuration =
    totalRuns > 0
      ? runs.reduce((s, r) => s + r.metrics.wallTimeMs, 0) / totalRuns
      : 0;

  const stats = {
    totalRuns: String(totalRuns),
    running: String(running),
    successRate: `${successRate}%`,
    totalCost: formatCost(totalCost),
    avgDuration: formatDuration(avgDuration),
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Runs</h1>
          <p className="text-sm text-muted">
            {runs.length} run{runs.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      {runs.length > 0 && <DashboardStats stats={stats} />}
      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <div className="text-4xl text-muted mb-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
              <path d="M18 24h12M24 18v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">No runs yet</p>
          <p className="text-xs text-muted mt-1">
            Start an agent run using the CLI to see it here.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading runs...</div>}>
          <RunsTable runs={JSON.parse(JSON.stringify(runs))} />
        </Suspense>
      )}
    </div>
  );
}
