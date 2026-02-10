"use client";

import type { Job } from "@agentops/core";
import { useJobs } from "@/hooks/useJobs";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import Link from "next/link";

export function JobsTable({ jobs: initialJobs }: { jobs: Job[] }) {
  const { jobs, loading, recentlyUpdated } = useJobs(initialJobs);

  if (loading && jobs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted">Loading jobs...</div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Priority
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Goal
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Repo
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Attempt
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Queued
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job) => {
            const id = job.id as string;
            const isUpdated = recentlyUpdated.has(id);
            return (
              <tr
                key={id}
                className={`transition-colors hover:bg-surface-2/50 ${
                  isUpdated ? "bg-accent/5" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/jobs/${id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {id.slice(0, 12)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <JobStatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={job.priority} />
                </td>
                <td className="px-4 py-3 max-w-[300px] truncate text-foreground">
                  {job.goal.humanReadable}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {job.environment.repo}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {job.attempt}/{job.maxAttempts}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(job.queuedAt).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
