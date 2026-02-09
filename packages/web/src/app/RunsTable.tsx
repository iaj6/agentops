"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import type { Run } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { TimeAgo } from "@/components/TimeAgo";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
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

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

export function RunsTable({ runs: initialRuns }: { runs: Run[] }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/runs?limit=50");
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full ${refreshing ? "bg-accent animate-pulse" : "bg-green"}`}
        />
        Auto-refreshing every 10s
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wider text-muted">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Goal</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Repo</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Duration</th>
              <th className="px-4 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id as string}
                onClick={() => router.push(`/runs/${run.id}`)}
                className="cursor-pointer border-b border-border transition-colors hover:bg-surface-2"
              >
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  {(run.id as string).slice(0, 8)}
                </td>
                <td className="max-w-xs px-4 py-3 text-foreground">
                  {truncate(run.goal.humanReadable, 60)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {run.environment.repo}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {run.environment.branch}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                  {formatCost(run.metrics.costUsd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                  {formatDuration(run.metrics.wallTimeMs)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted">
                  <TimeAgo date={run.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
