"use client";

import { useState } from "react";
import type { Job } from "@agentops/core";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import Link from "next/link";

export function JobDetail({ job: initialJob }: { job: Job }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [actionLoading, setActionLoading] = useState(false);

  async function handleAction(action: "cancel" | "retry") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/jobs/${job.id as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const updated = await res.json();
        setJob(updated);
      }
    } finally {
      setActionLoading(false);
    }
  }

  const canCancel = ["queued", "dispatched", "running"].includes(job.status);
  const canRetry = ["failed", "cancelled"].includes(job.status);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <Link
            href="/jobs"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Jobs
          </Link>
          <div className="flex items-center gap-2">
            {canCancel && (
              <button
                onClick={() => handleAction("cancel")}
                disabled={actionLoading}
                className="rounded border border-red/30 bg-red/10 px-3 py-1 text-xs font-medium text-red hover:bg-red/20 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            {canRetry && (
              <button
                onClick={() => handleAction("retry")}
                disabled={actionLoading}
                className="rounded border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                Retry
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold text-foreground">
            {(job.id as string).slice(0, 12)}
          </h1>
          <JobStatusBadge status={job.status} />
          <PriorityBadge priority={job.priority} />
        </div>
        <p className="mt-1 text-sm text-foreground">{job.goal.humanReadable}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            <span className="text-muted/70">Repo</span>{" "}
            <span className="font-mono">{job.environment.repo}</span>
          </span>
          <span>
            <span className="text-muted/70">Branch</span>{" "}
            <span className="font-mono">{job.environment.branch}</span>
          </span>
          <span>
            <span className="text-muted/70">Attempt</span>{" "}
            {job.attempt}/{job.maxAttempts}
          </span>
          <span>
            <span className="text-muted/70">Queued</span>{" "}
            {new Date(job.queuedAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Details grid */}
      <div className="space-y-6">
        {/* Goal */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Goal
          </h3>
          <p className="text-sm text-foreground">{job.goal.humanReadable}</p>
          <div className="mt-2 rounded bg-surface-2 p-3 font-mono text-xs text-muted">
            <span className="text-accent">{job.goal.structured.type}</span>
            : {job.goal.structured.description}
          </div>
        </div>

        {/* Environment */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Environment
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted">Repo: </span>
              <span className="font-mono text-foreground">{job.environment.repo}</span>
            </div>
            <div>
              <span className="text-muted">Branch: </span>
              <span className="font-mono text-foreground">{job.environment.branch}</span>
            </div>
            <div>
              <span className="text-muted">Sandbox: </span>
              <span className="text-foreground">
                {job.environment.sandbox.enabled ? "Enabled" : "Disabled"}
                {job.environment.sandbox.enabled &&
                  ` (${job.environment.sandbox.isolationLevel})`}
              </span>
            </div>
          </div>
        </div>

        {/* Retry Policy */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Retry Policy
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted">Max Retries: </span>
              <span className="font-mono text-foreground">{job.retryPolicy.maxRetries}</span>
            </div>
            <div>
              <span className="text-muted">Backoff: </span>
              <span className="font-mono text-foreground">{job.retryPolicy.backoffMs}ms</span>
            </div>
            <div>
              <span className="text-muted">Multiplier: </span>
              <span className="font-mono text-foreground">{job.retryPolicy.backoffMultiplier}x</span>
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Timeline
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Created</span>
              <span className="font-mono text-foreground">
                {new Date(job.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Queued</span>
              <span className="font-mono text-foreground">
                {new Date(job.queuedAt).toLocaleString()}
              </span>
            </div>
            {job.dispatchedAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted">Dispatched</span>
                <span className="font-mono text-foreground">
                  {new Date(job.dispatchedAt).toLocaleString()}
                </span>
              </div>
            )}
            {job.completedAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted">Completed</span>
                <span className="font-mono text-foreground">
                  {new Date(job.completedAt).toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted">Last Updated</span>
              <span className="font-mono text-foreground">
                {new Date(job.updatedAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Linked Runs */}
        {job.runIds.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Linked Runs ({job.runIds.length})
            </h3>
            <div className="space-y-2">
              {job.runIds.map((runId) => (
                <Link
                  key={runId as string}
                  href={`/runs/${runId as string}`}
                  className="block rounded bg-surface-2 px-3 py-2 font-mono text-xs text-accent hover:underline"
                >
                  {runId as string}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Session */}
        {job.sessionId && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
              Session
            </h3>
            <span className="font-mono text-sm text-accent">
              {job.sessionId as string}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
