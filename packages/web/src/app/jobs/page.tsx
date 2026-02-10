import { Suspense } from "react";
import { listJobs } from "@agentops/db";
import { db } from "@/lib/db";
import { JobsTable } from "./JobsTable";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = listJobs(db(), { limit: 50 });

  const queued = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.filter((j) => j.status === "running" || j.status === "dispatched").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Jobs</h1>
          <p className="text-sm text-muted">
            {jobs.length} job{jobs.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Stats bar */}
      {jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Queued</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{queued}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Running</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{running}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Completed</p>
            <p className="mt-1 text-2xl font-semibold text-green">{completed}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Failed</p>
            <p className="mt-1 text-2xl font-semibold text-red">{failed}</p>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <p className="text-sm font-medium text-foreground">No jobs yet</p>
          <p className="text-xs text-muted mt-1">
            Submit a job using the CLI to see it here.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading jobs...</div>}>
          <JobsTable jobs={JSON.parse(JSON.stringify(jobs))} />
        </Suspense>
      )}
    </div>
  );
}
