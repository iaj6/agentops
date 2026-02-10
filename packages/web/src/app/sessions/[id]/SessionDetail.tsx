"use client";

import { useState, useCallback } from "react";
import type { Session } from "@agentops/core";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { ResourceUsageBar } from "@/components/ResourceUsageBar";
import Link from "next/link";

export function SessionDetail({ session: initialSession }: { session: Session }) {
  const [session, setSession] = useState<Session>(initialSession);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = useCallback(async (action: "pause" | "resume" | "terminate") => {
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
  }, [session.id]);

  const canPause = session.status === "active";
  const canResume = session.status === "paused";
  const canTerminate = session.status === "active" || session.status === "paused";

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2">
          <Link
            href="/sessions"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Sessions
          </Link>
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
              <span className="font-mono text-foreground">{session.agentId as string}</span>
            </div>
            <div>
              <span className="text-muted">Started: </span>
              <span className="text-foreground">{new Date(session.startedAt).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted">Last Heartbeat: </span>
              <span className="text-foreground">{new Date(session.lastHeartbeatAt).toLocaleString()}</span>
            </div>
            {session.terminatedAt && (
              <div>
                <span className="text-muted">Terminated: </span>
                <span className="text-foreground">{new Date(session.terminatedAt).toLocaleString()}</span>
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

        {/* Resource Usage */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Resource Usage
          </h3>
          <ResourceUsageBar usage={session.resourceUsage} />
        </div>

        {/* Completed Runs */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Completed Runs ({session.completedRunIds.length})
          </h3>
          {session.completedRunIds.length === 0 ? (
            <p className="text-sm text-muted">No completed runs.</p>
          ) : (
            <div className="space-y-1.5">
              {session.completedRunIds.map((runId) => (
                <div key={runId as string} className="rounded bg-surface-2 px-3 py-2">
                  <Link
                    href={`/runs/${runId as string}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {runId as string}
                  </Link>
                </div>
              ))}
            </div>
          )}
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
