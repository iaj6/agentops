"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Job } from "@agentops/core";
import { JobStatus, JobPriority } from "@agentops/core";
import { useJobs } from "@/hooks/useJobs";
import { JobStatusBadge } from "@/components/JobStatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import Link from "next/link";

type SortField = "status" | "priority" | "queued";
type SortDir = "asc" | "desc";

const ALL_STATUSES = Object.values(JobStatus);
const ALL_PRIORITIES = Object.values(JobPriority);

export function JobsTable({ jobs: initialJobs }: { jobs: Job[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { jobs, loading, recentlyUpdated } = useJobs(initialJobs);

  // Filters from URL
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") ?? "",
  );
  const [priorityFilter, setPriorityFilter] = useState<string>(
    searchParams.get("priority") ?? "",
  );
  const [repoFilter, setRepoFilter] = useState<string>(
    searchParams.get("repo") ?? "",
  );
  const [sortBy, setSortBy] = useState<SortField>(
    (searchParams.get("sortBy") as SortField) ?? "queued",
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    (searchParams.get("sortDir") as SortDir) ?? "desc",
  );
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // Unique repos for filter dropdown
  const repos = useMemo(() => {
    const set = new Set(jobs.map((j) => j.environment.repo));
    return Array.from(set).sort();
  }, [jobs]);

  // Filter and sort
  const displayJobs = useMemo(() => {
    let filtered = jobs;
    if (statusFilter) {
      filtered = filtered.filter((j) => j.status === statusFilter);
    }
    if (priorityFilter) {
      filtered = filtered.filter((j) => j.priority === priorityFilter);
    }
    if (repoFilter) {
      filtered = filtered.filter((j) => j.environment.repo === repoFilter);
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "priority": {
          const order = { critical: 0, high: 1, normal: 2, low: 3 };
          cmp =
            (order[a.priority as keyof typeof order] ?? 2) -
            (order[b.priority as keyof typeof order] ?? 2);
          break;
        }
        case "queued":
        default:
          cmp = a.queuedAt.localeCompare(b.queuedAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [jobs, statusFilter, priorityFilter, repoFilter, sortBy, sortDir]);

  // Sync filters to URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (priorityFilter) p.set("priority", priorityFilter);
    if (repoFilter) p.set("repo", repoFilter);
    if (sortBy !== "queued") p.set("sortBy", sortBy);
    if (sortDir !== "desc") p.set("sortDir", sortDir);
    const qs = p.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [statusFilter, priorityFilter, repoFilter, sortBy, sortDir, pathname, router]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, displayJobs.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      } else if (
        e.key === "Enter" &&
        selectedIdx >= 0 &&
        selectedIdx < displayJobs.length
      ) {
        e.preventDefault();
        router.push(`/jobs/${displayJobs[selectedIdx].id as string}`);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [displayJobs, selectedIdx, router]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return null;
    return (
      <span className="ml-1 text-accent">
        {sortDir === "asc" ? "\u2191" : "\u2193"}
      </span>
    );
  }

  if (loading && jobs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        Loading jobs...
      </div>
    );
  }

  const selectClass =
    "rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none";

  return (
    <div>
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All Priorities</option>
          {ALL_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All Repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {(statusFilter || priorityFilter || repoFilter) && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter("");
              setPriorityFilter("");
              setRepoFilter("");
            }}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          {displayJobs.length} job{displayJobs.length !== 1 ? "s" : ""}
          {displayJobs.length !== jobs.length && ` of ${jobs.length}`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                ID
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("status")}
              >
                Status
                <SortIcon field="status" />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("priority")}
              >
                Priority
                <SortIcon field="priority" />
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
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("queued")}
              >
                Queued
                <SortIcon field="queued" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayJobs.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  No jobs match the current filters.
                </td>
              </tr>
            )}
            {displayJobs.map((job, idx) => {
              const id = job.id as string;
              const isUpdated = recentlyUpdated.has(id);
              const isSelected = idx === selectedIdx;
              return (
                <tr
                  key={id}
                  onClick={() => router.push(`/jobs/${id}`)}
                  className={`cursor-pointer transition-colors hover:bg-surface-2/50 ${
                    isSelected
                      ? "bg-accent/5 ring-1 ring-inset ring-accent/20"
                      : isUpdated
                        ? "bg-accent/5"
                        : ""
                  }`}
                  style={{
                    transition: "background-color 0.5s ease-in-out",
                  }}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${id}`}
                      className="font-mono text-xs text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
