"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Session, Run } from "@agentops/core";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { ResourceUsageBar } from "@/components/ResourceUsageBar";
import Link from "next/link";

const TERMINAL_STATUSES = new Set(["terminated"]);

function CompletedRunsTable({ runIds }: { runIds: readonly string[] }) {
  const [runs, setRuns] = useState<Map<string, Run>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (runIds.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchRuns() {
      const results = new Map<string, Run>();
      await Promise.all(
        runIds.map(async (id) => {
          try {
            const res = await fetch(`/api/runs/${id}`);
            if (res.ok && !cancelled) {
              const run = await res.json();
              results.set(id, run);
            }
          } catch {
            // Skip individual failures
          }
        }),
      );
      if (!cancelled) {
        setRuns(results);
        setLoading(false);
      }
    }
    fetchRuns();
    return () => {
      cancelled = true;
    };
  }, [runIds]);

  if (runIds.length === 0) {
    return <p className="text-sm text-muted">No completed runs.</p>;
  }

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-muted animate-pulse">
        Loading run details...
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted">
            <th className="pb-2 pr-4">Run ID</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Goal</th>
            <th className="pb-2 pr-4 text-right">Cost</th>
            <th className="pb-2 text-right">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {runIds.map((id) => {
            const run = runs.get(id);
            return (
              <tr key={id} className="hover:bg-surface-2/50 transition-colors">
                <td className="py-2 pr-4">
                  <Link
                    href={`/runs/${id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {id.slice(0, 12)}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {run ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        run.status === "completed"
                          ? "bg-green/15 text-green"
                          : run.status === "failed"
                            ? "bg-red/15 text-red"
                            : "bg-muted/15 text-muted"
                      }`}
                    >
                      {run.status}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">-</span>
                  )}
                </td>
                <td className="py-2 pr-4 max-w-[200px] truncate text-xs text-muted">
                  {run?.goal.humanReadable ?? "-"}
                </td>
                <td className="py-2 pr-4 text-right font-mono text-xs text-foreground">
                  {run ? `$${run.metrics.costUsd.toFixed(4)}` : "-"}
                </td>
                <td className="py-2 text-right font-mono text-xs text-foreground">
                  {run
                    ? `${Math.round(run.metrics.wallTimeMs / 1000)}s`
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResourceChart({ usage }: { usage: Session["resourceUsage"] }) {
  const items = [
    {
      label: "Memory",
      value: usage.memoryMb,
      max: 2048,
      unit: "MB",
      pct: Math.min((usage.memoryMb / 2048) * 100, 100),
    },
    {
      label: "CPU",
      value: usage.cpuPercent,
      max: 100,
      unit: "%",
      pct: Math.min(usage.cpuPercent, 100),
    },
    {
      label: "Token Budget",
      value: usage.tokensBudgetRemaining,
      max: 500000,
      unit: "tokens",
      pct: Math.min((usage.tokensBudgetRemaining / 500000) * 100, 100),
    },
    {
      label: "Cost Budget",
      value: usage.costBudgetRemaining,
      max: 50,
      unit: "USD",
      pct: Math.min((usage.costBudgetRemaining / 50) * 100, 100),
    },
  ];

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const color =
          item.label === "Memory" || item.label === "CPU"
            ? item.pct > 80
              ? "bg-red"
              : item.pct > 50
                ? "bg-yellow"
                : "bg-green"
            : item.pct < 20
              ? "bg-red"
              : item.pct < 50
                ? "bg-yellow"
                : "bg-green";

        return (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted">{item.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-foreground">
                  {item.value.toFixed(1)} {item.unit}
                </span>
                <span className="font-mono text-muted text-[10px]">
                  ({item.pct.toFixed(0)}%)
                </span>
              </div>
            </div>
            <div className="h-3 w-full rounded-full bg-surface-2">
              <div
                className={`h-3 rounded-full ${color} transition-all`}
                style={{ width: `${item.pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SessionDetail({
  session: initialSession,
}: {
  session: Session;
}) {
  const [session, setSession] = useState<Session>(initialSession);
  const [actionLoading, setActionLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh every 5s for active sessions
  useEffect(() => {
    const isActive = !TERMINAL_STATUSES.has(session.status);
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id as string}`);
        if (res.ok) {
          const updated = await res.json();
          setSession(updated);
        }
      } catch {
        // Ignore errors during polling
      }
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [session.id, session.status]);

  const handleAction = useCallback(
    async (action: "pause" | "resume" | "terminate") => {
      setActionLoading(true);
      try {
        const res = await fetch(`/api/sessions/${session.id as string}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (res.ok) {
          const updated = await res.json();
          setSession(updated);
        }
      } finally {
        setActionLoading(false);
      }
    },
    [session.id],
  );

  const canPause = session.status === "active";
  const canResume = session.status === "paused";
  const canTerminate =
    session.status === "active" || session.status === "paused";
  const isActive = !TERMINAL_STATUSES.has(session.status);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/sessions"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Sessions
          </Link>
          {isActive && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
              </span>
              Auto-refreshing
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold text-foreground">
            {(session.id as string).slice(0, 16)}
          </h1>
          <SessionStatusBadge status={session.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <span className="text-muted/70">Agent</span>{" "}
            <span className="font-mono">{session.agentId as string}</span>
          </span>
          <span>
            <span className="text-muted/70">Created</span>{" "}
            {new Date(session.createdAt).toLocaleString()}
          </span>
          <span>
            <span className="text-muted/70">Updated</span>{" "}
            {new Date(session.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Intervention Buttons */}
      {canTerminate && (
        <div className="mb-6 flex items-center gap-2">
          {canPause && (
            <button
              onClick={() => handleAction("pause")}
              disabled={actionLoading}
              className="rounded-md border border-yellow/30 bg-yellow/10 px-3 py-1.5 text-xs font-medium text-yellow hover:bg-yellow/20 transition-colors disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {canResume && (
            <button
              onClick={() => handleAction("resume")}
              disabled={actionLoading}
              className="rounded-md border border-green/30 bg-green/10 px-3 py-1.5 text-xs font-medium text-green hover:bg-green/20 transition-colors disabled:opacity-50"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => handleAction("terminate")}
            disabled={actionLoading}
            className="rounded-md border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/20 transition-colors disabled:opacity-50"
          >
            Terminate
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* Session Info */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Session Info
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted">Status: </span>
              <span className="text-foreground">{session.status}</span>
            </div>
            <div>
              <span className="text-muted">Agent: </span>
              <span className="font-mono text-foreground">
                {session.agentId as string}
              </span>
            </div>
            <div>
              <span className="text-muted">Started: </span>
              <span className="text-foreground">
                {new Date(session.startedAt).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-muted">Last Heartbeat: </span>
              <span className="text-foreground">
                {new Date(session.lastHeartbeatAt).toLocaleString()}
              </span>
            </div>
            {session.terminatedAt && (
              <div>
                <span className="text-muted">Terminated: </span>
                <span className="text-foreground">
                  {new Date(session.terminatedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Current Run */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Current Run
          </h3>
          {session.currentRunId ? (
            <Link
              href={`/runs/${session.currentRunId as string}`}
              className="font-mono text-sm text-accent hover:underline"
            >
              {session.currentRunId as string}
            </Link>
          ) : (
            <p className="text-sm text-muted">No run currently assigned.</p>
          )}
        </div>

        {/* Resource Usage Chart */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Resource Usage
          </h3>
          <ResourceChart usage={session.resourceUsage} />
        </div>

        {/* Completed Runs Table */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Completed Runs ({session.completedRunIds.length})
          </h3>
          <CompletedRunsTable
            runIds={session.completedRunIds.map((id) => id as string)}
          />
        </div>

        {/* Metadata */}
        {Object.keys(session.metadata).length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Metadata
            </h3>
            <pre className="rounded bg-surface-2 p-3 text-xs text-foreground font-mono overflow-auto max-h-60">
              {JSON.stringify(session.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
