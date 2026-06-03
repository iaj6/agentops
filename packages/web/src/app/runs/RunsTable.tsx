"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { Run } from "@agentops/core";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SearchBar } from "@/components/SearchBar";
import { FilterPanel, type Filters, emptyFilters } from "@/components/FilterPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { SessionSummaryCard, RunFallbackCard } from "@/components/SessionSummaryCard";
import type { UserSummary } from "@/components/UserChip";
import { UserFilter } from "@/components/UserFilter";
import { useRuns, type RunWithSummary } from "@/hooks/useRuns";

type SortField = "status" | "duration" | "created" | "score";
type SortDir = "asc" | "desc";

const PAGE_SIZES = [25, 50, 100];

export function RunsTable({
  runs: initialRuns,
  users = [],
  currentUser,
}: {
  runs: RunWithSummary[];
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

  // SSE real-time connection. Scope is read from the URL so a sidebar
  // dropdown change triggers a re-fetch with the new userId/view filter
  // instead of replaying the cached unscoped data from the initial mount.
  const { runsWithSummaries: liveRunsWithSummaries, connected, recentlyUpdated } = useRuns(
    initialRuns,
    {
      view: searchParams.get("view"),
      userId: searchParams.get("userId"),
    },
  );

  // Read initial state from URL
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [filters, setFilters] = useState<Filters>({
    status: searchParams.getAll("status"),
    repo: searchParams.getAll("repo"),
    branch: searchParams.getAll("branch"),
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
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
  const [serverRuns, setServerRuns] = useState<RunWithSummary[] | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hasActiveSearch =
    query.trim() !== "" ||
    filters.status.length > 0 ||
    filters.repo.length > 0 ||
    filters.branch.length > 0 ||
    filters.from !== "" ||
    filters.to !== "";

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
      p.set("sortBy", sortBy);
      p.set("sortDir", sortDir);
      p.set("limit", String(pageSize));
      p.set("offset", String((page - 1) * pageSize));
      // Carry through the current view scope (?view= or ?userId=) so
      // the search API applies the same filter the SSR page used.
      const view = searchParams.get("view");
      if (view) p.set("view", view);
      const userId = searchParams.get("userId");
      if (userId) p.set("userId", userId);

      const res = await fetch(`/api/runs/search?${p.toString()}`);
      if (res.ok) {
        const data = await res.json();
        // Search API returns Run[], wrap them as RunWithSummary for consistency
        const searchRuns: RunWithSummary[] = (data.runs ?? []).map((r: Run) => ({ run: r, summary: null }));
        setServerRuns(searchRuns);
        setServerTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [query, filters, sortBy, sortDir, page, pageSize, hasActiveSearch, searchParams]);

  // Debounced fetch + URL sync
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSearchResults();

      // Update URL params. Preserve the active view scope (?view= or
      // ?userId=) — the inline UserFilter chip manages those and we
      // don't want a filter change to silently drop them.
      const p = new URLSearchParams();
      const view = searchParams.get("view");
      if (view) p.set("view", view);
      const userId = searchParams.get("userId");
      if (userId) p.set("userId", userId);
      if (query.trim()) p.set("q", query.trim());
      for (const st of filters.status) p.append("status", st);
      for (const r of filters.repo) p.append("repo", r);
      for (const b of filters.branch) p.append("branch", b);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (sortBy !== "created") p.set("sortBy", sortBy);
      if (sortDir !== "desc") p.set("sortDir", sortDir);
      if (page > 1) p.set("page", String(page));
      if (pageSize !== 50) p.set("pageSize", String(pageSize));

      const qs = p.toString();
      const newUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(newUrl, { scroll: false });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, filters, sortBy, sortDir, page, pageSize, fetchSearchResults, pathname, router, searchParams]);

  // Client-side sort for live runs (when no server search is active)
  const clientSorted = useMemo(() => {
    if (serverRuns !== null) return serverRuns;

    const sorted = [...liveRunsWithSummaries];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "status":
          cmp = a.run.status.localeCompare(b.run.status);
          break;
        case "duration":
          cmp = a.run.metrics.wallTimeMs - b.run.metrics.wallTimeMs;
          break;
        case "score": {
          const sa =
            a.run.evaluations.length > 0 ? a.run.evaluations[0].confidenceScore : 0;
          const sb =
            b.run.evaluations.length > 0 ? b.run.evaluations[0].confidenceScore : 0;
          cmp = sa - sb;
          break;
        }
        case "created":
        default:
          cmp = a.run.createdAt.localeCompare(b.run.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [liveRunsWithSummaries, serverRuns, sortBy, sortDir]);

  // Paginate client-side sorted runs
  const displayRuns = useMemo(() => {
    if (serverRuns !== null) return clientSorted;
    const start = (page - 1) * pageSize;
    return clientSorted.slice(start, start + pageSize);
  }, [clientSorted, serverRuns, page, pageSize]);

  const total = serverTotal !== null ? serverTotal : liveRunsWithSummaries.length;
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
        router.push(`/runs/${displayRuns[selectedIdx].run.id}`);
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

      {/* User-scope filter (admin only — hidden for members) */}
      {currentUser.role === "admin" && (
        <div className="mb-3 flex items-center">
          <UserFilter currentUserId={currentUser.id} canSelect />
        </div>
      )}

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

      {/* Sort controls */}
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <span>Sort by:</span>
        {(["created", "status", "duration", "score"] as SortField[]).map((field) => (
          <button
            key={field}
            onClick={() => handleSort(field)}
            className={`rounded border px-2 py-1 transition-colors ${
              sortBy === field
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface hover:text-foreground"
            }`}
          >
            {field.charAt(0).toUpperCase() + field.slice(1)}
            <SortIcon field={field} />
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="space-y-3">
        {displayRuns.length === 0 && !loading && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-12">
            <p className="text-sm text-muted">No runs match the current filters.</p>
          </div>
        )}
        {displayRuns.map(({ run, summary }, idx) => {
          const isHighlighted = recentlyUpdated.has(run.id as string);
          const isSelected = idx === selectedIdx;

          const user = run.userId
            ? (userById.get(run.userId as string) ?? null)
            : null;

          if (summary) {
            return (
              <SessionSummaryCard
                key={run.id as string}
                run={run}
                summary={summary}
                user={user}
                isHighlighted={isHighlighted}
                isSelected={isSelected}
                onClick={() => router.push(`/runs/${run.id}`)}
              />
            );
          }

          return (
            <RunFallbackCard
              key={run.id as string}
              run={run}
              user={user}
              isHighlighted={isHighlighted}
              isSelected={isSelected}
              onClick={() => router.push(`/runs/${run.id}`)}
            />
          );
        })}
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
