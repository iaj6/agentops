"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { Run } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SearchBar } from "@/components/SearchBar";
import { FilterPanel, type Filters, emptyFilters } from "@/components/FilterPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { useRuns } from "@/hooks/useRuns";

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

type SortField = "status" | "cost" | "duration" | "created" | "score";
type SortDir = "asc" | "desc";

const PAGE_SIZES = [25, 50, 100];

export function RunsTable({ runs: initialRuns }: { runs: Run[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // SSE real-time connection
  const { runs: liveRuns, connected, recentlyUpdated } = useRuns(initialRuns);

  // Read initial state from URL
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [filters, setFilters] = useState<Filters>({
    status: searchParams.getAll("status"),
    repo: searchParams.getAll("repo"),
    branch: searchParams.getAll("branch"),
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    minCost: searchParams.get("minCost") ?? "",
    maxCost: searchParams.get("maxCost") ?? "",
  });
  const [sortBy, setSortBy] = useState<SortField>(
    (searchParams.get("sortBy") as SortField) ?? "created"
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    (searchParams.get("sortDir") as SortDir) ?? "desc"
  );
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1"));
  const [pageSize, setPageSize] = useState(
    Number(searchParams.get("pageSize") ?? "50")
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  // Server-side search results (used when query/advanced filters are active)
  const [serverRuns, setServerRuns] = useState<Run[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hasActiveSearch =
    query.trim() !== "" ||
    filters.status.length > 0 ||
    filters.repo.length > 0 ||
    filters.branch.length > 0 ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.minCost !== "" ||
    filters.maxCost !== "";

  // Fetch from search API when filters/search are active
  const fetchSearchResults = useCallback(async () => {
    if (!hasActiveSearch && sortBy === "created" && sortDir === "desc") {
      setServerRuns(null);
      setServerTotal(null);
      return;
    }

    setLoading(true);
    try {
      const p = new URLSearchParams();
      const q = query.trim();
      if (q) p.set("q", q);
      for (const st of filters.status) p.append("status", st);
      for (const r of filters.repo) p.append("repo", r);
      for (const b of filters.branch) p.append("branch", b);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.minCost) p.set("minCost", filters.minCost);
      if (filters.maxCost) p.set("maxCost", filters.maxCost);
      p.set("sortBy", sortBy);
      p.set("sortDir", sortDir);
      p.set("limit", String(pageSize));
      p.set("offset", String((page - 1) * pageSize));

      const res = await fetch(`/api/runs/search?${p.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setServerRuns(data.runs ?? []);
        setServerTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [query, filters, sortBy, sortDir, page, pageSize, hasActiveSearch]);

  // Debounced fetch + URL sync
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSearchResults();

      // Update URL params
      const p = new URLSearchParams();
      if (query.trim()) p.set("q", query.trim());
      for (const st of filters.status) p.append("status", st);
      for (const r of filters.repo) p.append("repo", r);
      for (const b of filters.branch) p.append("branch", b);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.minCost) p.set("minCost", filters.minCost);
      if (filters.maxCost) p.set("maxCost", filters.maxCost);
      if (sortBy !== "created") p.set("sortBy", sortBy);
      if (sortDir !== "desc") p.set("sortDir", sortDir);
      if (page > 1) p.set("page", String(page));
      if (pageSize !== 50) p.set("pageSize", String(pageSize));

      const qs = p.toString();
      const newUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(newUrl, { scroll: false });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, filters, sortBy, sortDir, page, pageSize, fetchSearchResults, pathname, router]);

  // Client-side sort for live runs (when no server search is active)
  const clientSorted = useMemo(() => {
    if (serverRuns !== null) return serverRuns;

    const sorted = [...liveRuns];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "cost":
          cmp = a.metrics.costUsd - b.metrics.costUsd;
          break;
        case "duration":
          cmp = a.metrics.wallTimeMs - b.metrics.wallTimeMs;
          break;
        case "score": {
          const sa =
            a.evaluations.length > 0 ? a.evaluations[0].confidenceScore : 0;
          const sb =
            b.evaluations.length > 0 ? b.evaluations[0].confidenceScore : 0;
          cmp = sa - sb;
          break;
        }
        case "created":
        default:
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [liveRuns, serverRuns, sortBy, sortDir]);

  // Paginate client-side sorted runs
  const displayRuns = useMemo(() => {
    if (serverRuns !== null) return clientSorted;
    const start = (page - 1) * pageSize;
    return clientSorted.slice(start, start + pageSize);
  }, [clientSorted, serverRuns, page, pageSize]);

  const total = serverTotal !== null ? serverTotal : liveRuns.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keyboard navigation: j/k to move, Enter to open
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (paletteOpen) return;

      if (e.key === "j") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, displayRuns.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      } else if (
        e.key === "Enter" &&
        selectedIdx >= 0 &&
        selectedIdx < displayRuns.length
      ) {
        e.preventDefault();
        router.push(`/runs/${displayRuns[selectedIdx].id}`);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [displayRuns, selectedIdx, router, paletteOpen]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  function handleClearFilters() {
    setFilters(emptyFilters);
    setQuery("");
    setPage(1);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return null;
    return (
      <span className="ml-1 text-accent">
        {sortDir === "asc" ? "\u2191" : "\u2193"}
      </span>
    );
  }

  return (
    <div>
      {/* Command palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Search bar */}
      <div className="mb-3">
        <SearchBar
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          onCommandPalette={() => setPaletteOpen(true)}
          resultCount={displayRuns.length}
          totalCount={total}
        />
      </div>

      {/* Filter panel */}
      <FilterPanel
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
        onClear={handleClearFilters}
      />

      {/* Status bar */}
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-3">
          <ConnectionStatus connected={connected} />
          <span>
            {loading
              ? "Searching..."
              : `${total} run${total !== 1 ? "s" : ""}`}
            {hasActiveSearch && !loading && (
              <span className="ml-1">(showing {displayRuns.length})</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground focus:border-accent focus:outline-none"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm responsive-table">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wider text-muted">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Goal</th>
              <th
                className="cursor-pointer select-none px-4 py-3 hover:text-foreground"
                onClick={() => handleSort("status")}
              >
                Status
                <SortIcon field="status" />
              </th>
              <th className="px-4 py-3">Repo</th>
              <th className="px-4 py-3">Branch</th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-right hover:text-foreground"
                onClick={() => handleSort("cost")}
              >
                Cost
                <SortIcon field="cost" />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-right hover:text-foreground"
                onClick={() => handleSort("duration")}
              >
                Duration
                <SortIcon field="duration" />
              </th>
              <th
                className="cursor-pointer select-none px-4 py-3 text-right hover:text-foreground"
                onClick={() => handleSort("created")}
              >
                Created
                <SortIcon field="created" />
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRuns.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  No runs match the current filters.
                </td>
              </tr>
            )}
            {displayRuns.map((run, idx) => {
              const isHighlighted = recentlyUpdated.has(run.id as string);
              const isSelected = idx === selectedIdx;
              return (
                <tr
                  key={run.id as string}
                  onClick={() => router.push(`/runs/${run.id}`)}
                  className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-2 ${
                    isSelected
                      ? "bg-accent/5 ring-1 ring-inset ring-accent/20"
                      : isHighlighted
                        ? "bg-accent/5"
                        : ""
                  }`}
                  style={{
                    transition: "background-color 0.5s ease-in-out",
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs text-accent">
                    <span className="flex items-center gap-1.5">
                      {(run.id as string).slice(0, 8)}
                      {run.github?.pr && (
                        <a
                          href={run.github.pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-accent hover:border-accent transition-colors"
                          title={`PR #${run.github.pr.number}: ${run.github.pr.title}`}
                        >
                          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/></svg>
                          #{run.github.pr.number}
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-foreground mobile-full">
                    {truncate(run.goal.humanReadable, 60)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted mobile-hide">
                    {run.environment.repo}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted mobile-hide">
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded border border-border bg-surface px-3 py-1.5 text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="rounded border border-border bg-surface px-3 py-1.5 text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
