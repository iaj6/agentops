"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Session } from "@agentops/core";
import { SessionStatus, isStaleSession } from "@agentops/core";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { StaleBadge } from "@/components/StaleBadge";
import { UserChip, type UserSummary } from "@/components/UserChip";
import { UserFilter } from "@/components/UserFilter";
import { useSessions } from "@/hooks/useSessions";
import Link from "next/link";

type SortField = "status" | "created" | "agent";
type SortDir = "asc" | "desc";

const ALL_STATUSES = Object.values(SessionStatus);

// Module-scope so the component reference is stable across renders
// (react-hooks/static-components). sortBy/sortDir are passed as props rather
// than captured from the parent closure.
function SortIcon({
  field,
  sortBy,
  sortDir,
}: {
  field: SortField;
  sortBy: SortField;
  sortDir: SortDir;
}) {
  if (sortBy !== field) return null;
  return (
    <span className="ml-1 text-accent">
      {sortDir === "asc" ? "↑" : "↓"}
    </span>
  );
}

export function SessionsTable({
  sessions: initialSessions,
  users = [],
  currentUser,
}: {
  sessions: Session[];
  users?: UserSummary[];
  currentUser: { id: string; role: string };
}) {
  const userById = useMemo(() => {
    const m = new Map<string, UserSummary>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { sessions, loading, recentlyUpdated } = useSessions(initialSessions, {
    view: searchParams.get("view"),
    userId: searchParams.get("userId"),
  });

  // Filters from URL
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") ?? "",
  );
  const [sortBy, setSortBy] = useState<SortField>(
    (searchParams.get("sortBy") as SortField) ?? "created",
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    (searchParams.get("sortDir") as SortDir) ?? "desc",
  );
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // Filter and sort
  const displaySessions = useMemo(() => {
    let filtered = sessions;
    if (statusFilter) {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "agent":
          cmp = (a.agentId as string).localeCompare(b.agentId as string);
          break;
        case "created":
        default:
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sessions, statusFilter, sortBy, sortDir]);

  // Sync filters to URL. Preserve view/userId — the UserFilter chip
  // owns those; a local filter change shouldn't silently reset them.
  useEffect(() => {
    const p = new URLSearchParams();
    const view = searchParams.get("view");
    if (view) p.set("view", view);
    const userId = searchParams.get("userId");
    if (userId) p.set("userId", userId);
    if (statusFilter) p.set("status", statusFilter);
    if (sortBy !== "created") p.set("sortBy", sortBy);
    if (sortDir !== "desc") p.set("sortDir", sortDir);
    const qs = p.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [statusFilter, sortBy, sortDir, pathname, router, searchParams]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j") {
        e.preventDefault();
        setSelectedIdx((prev) =>
          Math.min(prev + 1, displaySessions.length - 1),
        );
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      } else if (
        e.key === "Enter" &&
        selectedIdx >= 0 &&
        selectedIdx < displaySessions.length
      ) {
        e.preventDefault();
        router.push(
          `/sessions/${displaySessions[selectedIdx].id as string}`,
        );
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [displaySessions, selectedIdx, router]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  if (loading && sessions.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        Loading sessions...
      </div>
    );
  }

  const selectClass =
    "rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none";

  return (
    <div>
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {currentUser.role === "admin" && (
          <UserFilter currentUserId={currentUser.id} canSelect />
        )}
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
        {statusFilter && (
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          {displaySessions.length} session
          {displaySessions.length !== 1 ? "s" : ""}
          {displaySessions.length !== sessions.length &&
            ` of ${sessions.length}`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                ID
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("status")}
              >
                Status
                <SortIcon field="status" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("agent")}
              >
                Agent
                <SortIcon field="agent" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Current Run
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Completed
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted hover:text-foreground"
                onClick={() => handleSort("created")}
              >
                Created
                <SortIcon field="created" sortBy={sortBy} sortDir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody>
            {displaySessions.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  No sessions match the current filters.
                </td>
              </tr>
            )}
            {displaySessions.map((session, idx) => {
              const id = session.id as string;
              const isUpdated = recentlyUpdated.has(id);
              const isSelected = idx === selectedIdx;

              return (
                <tr
                  key={id}
                  onClick={() => router.push(`/sessions/${id}`)}
                  className={`cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-surface-2 ${
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
                      href={`/sessions/${id}`}
                      className="font-mono text-xs text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {id.slice(0, 16)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <SessionStatusBadge status={session.status} />
                      {isStaleSession(session) && <StaleBadge compact />}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {session.agentId as string}
                  </td>
                  <td className="px-4 py-3">
                    <UserChip
                      user={
                        session.userId
                          ? (userById.get(session.userId as string) ?? null)
                          : null
                      }
                      compact
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {session.currentRunId ? (
                      <Link
                        href={`/runs/${session.currentRunId as string}`}
                        className="text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(session.currentRunId as string).slice(0, 12)}
                      </Link>
                    ) : (
                      <span className="text-muted/50">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {session.completedRunIds.length}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {new Date(session.createdAt).toLocaleString()}
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
