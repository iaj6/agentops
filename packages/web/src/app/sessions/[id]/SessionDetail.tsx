"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Session, Run } from "@agentops/core";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { StaleBadge } from "@/components/StaleBadge";
import { UserChip, type UserSummary } from "@/components/UserChip";
import { CopyButton } from "@/components/CopyButton";
import { isStaleSession } from "@agentops/core";
import { toast } from "@/hooks/useToast";
import Link from "next/link";

const TERMINAL_STATUSES = new Set(["terminated"]);

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function CompletedRunsTable({
  runIds,
  onAggregate,
}: {
  runIds: readonly string[];
  onAggregate?: (a: { costUsd: number; tokens: number; runsLoaded: number }) => void;
}) {
  const [runs, setRuns] = useState<Map<string, Run>>(new Map());
  // Lazy initial value instead of setting it synchronously in the effect
  // (react-hooks/set-state-in-effect): only "loading" when there are runs to
  // fetch. setLoading(false) still fires after the fetch completes.
  const [loading, setLoading] = useState(() => runIds.length > 0);

  useEffect(() => {
    if (runIds.length === 0) {
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
              const body = (await res.json()) as { run?: Run };
              if (body.run) results.set(id, body.run);
            }
          } catch {
            // Skip individual failures
          }
        }),
      );
      if (!cancelled) {
        setRuns(results);
        setLoading(false);
        if (onAggregate) {
          let costUsd = 0;
          let tokens = 0;
          for (const run of results.values()) {
            costUsd += run.metrics?.costUsd ?? 0;
            tokens += run.metrics?.tokenUsage?.total ?? 0;
          }
          onAggregate({ costUsd, tokens, runsLoaded: results.size });
        }
      }
    }
    fetchRuns();
    return () => {
      cancelled = true;
    };
  }, [runIds, onAggregate]);

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
                  {run?.goal?.humanReadable ?? "-"}
                </td>
                <td className="py-2 pr-4 text-right font-mono text-xs text-foreground">
                  {run?.metrics?.costUsd != null
                    ? formatCost(run.metrics.costUsd)
                    : "-"}
                </td>
                <td className="py-2 text-right font-mono text-xs text-foreground">
                  {run?.metrics?.wallTimeMs != null
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

export function SessionDetail({
  session: initialSession,
  owner,
}: {
  session: Session;
  owner?: UserSummary | null;
}) {
  const [session, setSession] = useState<Session>(initialSession);
  const [actionLoading, setActionLoading] = useState(false);
  const [runAggregate, setRunAggregate] = useState<{
    costUsd: number;
    tokens: number;
    runsLoaded: number;
  } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Aggregator handler for CompletedRunsTable — stable identity so the
  // child's useEffect doesn't refetch on every render.
  const handleAggregate = useCallback(
    (a: { costUsd: number; tokens: number; runsLoaded: number }) => {
      setRunAggregate(a);
    },
    [],
  );

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

  const handleTerminate = useCallback(async () => {
    if (!confirm("Close this session? This marks it as closed in AgentOps but does not stop the running Claude Code process.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${session.id as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "terminate" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSession(updated);
        toast("Session terminated", "success");
      } else {
        const err = await res.json().catch(() => ({ error: "Terminate failed" }));
        toast(err.error ?? "Failed to terminate session", "error");
      }
    } catch {
      toast("Network error", "error");
    } finally {
      setActionLoading(false);
    }
  }, [session.id]);

  const canTerminate = session.status === "active";
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
          <CopyButton value={session.id as string} label="Copy ID" />
          <SessionStatusBadge status={session.status} />
          {isStaleSession(session) && <StaleBadge />}
          {owner !== undefined && <UserChip user={owner} />}
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
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <button
              onClick={handleTerminate}
              disabled={actionLoading}
              className="rounded-md border border-red/30 bg-red/10 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/20 transition-colors disabled:opacity-50"
            >
              Close Session
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Marks this session as closed in AgentOps. Does not stop the running Claude Code process.
          </p>
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

        {/* Resource Usage — aggregated from completed run metrics. The
            session.resourceUsage shape (memoryMb / cpuPercent / budgets)
            is unpopulated by hook-driven runs and would render zeros,
            so we surface the meaningful numbers here instead. */}
        {session.completedRunIds.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Resource Usage
            </h3>
            {runAggregate ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted">Total Cost: </span>
                  <span className="font-mono text-foreground">
                    {formatCost(runAggregate.costUsd)}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Total Tokens: </span>
                  <span className="font-mono text-foreground">
                    {formatTokens(runAggregate.tokens)}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Runs: </span>
                  <span className="font-mono text-foreground">
                    {runAggregate.runsLoaded} / {session.completedRunIds.length}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Avg / run: </span>
                  <span className="font-mono text-foreground">
                    {runAggregate.runsLoaded > 0
                      ? formatCost(runAggregate.costUsd / runAggregate.runsLoaded)
                      : "—"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">Computing…</p>
            )}
          </div>
        )}

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

        {/* Completed Runs Table */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Completed Runs ({session.completedRunIds.length})
          </h3>
          <CompletedRunsTable
            runIds={session.completedRunIds.map((id) => id as string)}
            onAggregate={handleAggregate}
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
