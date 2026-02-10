"use client";

import { useState, useEffect, useRef } from "react";
import type { Job, Run } from "@agentops/core";
import { JobStatus } from "@agentops/core";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import Link from "next/link";

const LIFECYCLE_STEPS = [
  { key: "queued", label: "Queued" },
  { key: "dispatched", label: "Dispatched" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
] as const;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function statusStepIndex(status: string): number {
  switch (status) {
    case "queued":
      return 0;
    case "dispatched":
      return 1;
    case "running":
      return 2;
    case "completed":
    case "failed":
    case "cancelled":
      return 3;
    default:
      return 0;
  }
}

function TimelineStepper({ job }: { job: Job }) {
  const currentStep = statusStepIndex(job.status);
  const isFailed = job.status === "failed" || job.status === "cancelled";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        Lifecycle
      </h3>
      <div className="flex items-center">
        {LIFECYCLE_STEPS.map((step, idx) => {
          const isCompleted = idx < currentStep;
          const isCurrent = idx === currentStep;
          const isTerminalFail = isCurrent && isFailed;
          const label =
            isCurrent && isFailed ? job.status : step.label;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors ${
                    isTerminalFail
                      ? "border-red bg-red/15 text-red"
                      : isCompleted
                        ? "border-green bg-green/15 text-green"
                        : isCurrent
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border bg-surface-2 text-muted"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isTerminalFail ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={`mt-1.5 text-[10px] font-medium ${
                    isTerminalFail
                      ? "text-red"
                      : isCompleted || isCurrent
                        ? "text-foreground"
                        : "text-muted"
                  }`}
                >
                  {label}
                </span>
              </div>
              {/* Connector line */}
              {idx < LIFECYCLE_STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 rounded-full ${
                    idx < currentStep ? "bg-green" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkedRunCard({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchRun() {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok && !cancelled) {
          setRun(await res.json());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRun();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <div className="rounded bg-surface-2 px-3 py-2 text-xs text-muted animate-pulse">
        Loading run {runId.slice(0, 12)}...
      </div>
    );
  }

  if (!run) {
    return (
      <Link
        href={`/runs/${runId}`}
        className="block rounded bg-surface-2 px-3 py-2 font-mono text-xs text-accent hover:underline"
      >
        {runId}
      </Link>
    );
  }

  return (
    <Link
      href={`/runs/${runId}`}
      className="block rounded bg-surface-2 px-3 py-3 hover:bg-surface-2/80 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-accent">{runId.slice(0, 12)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            run.status === "completed"
              ? "bg-green/15 text-green"
              : run.status === "failed"
                ? "bg-red/15 text-red"
                : run.status === "running"
                  ? "bg-blue/15 text-blue"
                  : "bg-muted/15 text-muted"
          }`}
        >
          {run.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted truncate">
        {run.goal.humanReadable}
      </p>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted">
        <span>
          Cost: <span className="font-mono text-foreground">${run.metrics.costUsd.toFixed(4)}</span>
        </span>
        <span>
          Duration: <span className="font-mono text-foreground">{Math.round(run.metrics.wallTimeMs / 1000)}s</span>
        </span>
      </div>
    </Link>
  );
}

export function JobDetail({ job: initialJob }: { job: Job }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [actionLoading, setActionLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh every 5s for active jobs
  useEffect(() => {
    const isActive = !TERMINAL_STATUSES.has(job.status);
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id as string}`);
        if (res.ok) {
          const updated = await res.json();
          setJob(updated);
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
  }, [job.id, job.status]);

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
  const isActive = !TERMINAL_STATUSES.has(job.status);

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
            {isActive && (
              <span className="flex items-center gap-1.5 text-[10px] text-muted">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
                </span>
                Auto-refreshing
              </span>
            )}
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
        <p className="mt-1 text-sm text-foreground">
          {job.goal.humanReadable}
        </p>
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
        {/* Lifecycle Stepper */}
        <TimelineStepper job={job} />

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
              <span className="font-mono text-foreground">
                {job.environment.repo}
              </span>
            </div>
            <div>
              <span className="text-muted">Branch: </span>
              <span className="font-mono text-foreground">
                {job.environment.branch}
              </span>
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
              <span className="font-mono text-foreground">
                {job.retryPolicy.maxRetries}
              </span>
            </div>
            <div>
              <span className="text-muted">Backoff: </span>
              <span className="font-mono text-foreground">
                {job.retryPolicy.backoffMs}ms
              </span>
            </div>
            <div>
              <span className="text-muted">Multiplier: </span>
              <span className="font-mono text-foreground">
                {job.retryPolicy.backoffMultiplier}x
              </span>
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
                <LinkedRunCard key={runId as string} runId={runId as string} />
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
            <Link
              href={`/sessions/${job.sessionId as string}`}
              className="font-mono text-sm text-accent hover:underline"
            >
              {job.sessionId as string}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
