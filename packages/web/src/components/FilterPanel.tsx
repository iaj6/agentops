"use client";

import { useEffect, useState } from "react";

export interface Filters {
  status: string[];
  repo: string[];
  branch: string[];
  from: string;
  to: string;
}

export const emptyFilters: Filters = {
  status: [],
  repo: [],
  branch: [],
  from: "",
  to: "",
};

const ALL_STATUSES = ["pending", "running", "completed", "failed", "blocked", "cancelled"];

interface FilterPanelProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onClear: () => void;
}

function ChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-surface text-muted hover:border-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ActiveChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-accent/60 hover:text-accent"
      >
        x
      </button>
    </span>
  );
}

export function FilterPanel({ filters, onChange, onClear }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/runs/search", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setRepos(data.repos ?? []);
        setBranches(data.branches ?? []);
      })
      .catch(() => {});
  }, []);

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.repo.length > 0 ||
    filters.branch.length > 0 ||
    filters.from !== "" ||
    filters.to !== "";

  function toggleStatus(s: string) {
    const next = filters.status.includes(s)
      ? filters.status.filter((x) => x !== s)
      : [...filters.status, s];
    onChange({ ...filters, status: next });
  }

  function toggleRepo(r: string) {
    const next = filters.repo.includes(r)
      ? filters.repo.filter((x) => x !== r)
      : [...filters.repo, r];
    onChange({ ...filters, repo: next });
  }

  function toggleBranch(b: string) {
    const next = filters.branch.includes(b)
      ? filters.branch.filter((x) => x !== b)
      : [...filters.branch, b];
    onChange({ ...filters, branch: next });
  }

  // Collect active filter chips
  const activeChips: { label: string; remove: () => void }[] = [];
  for (const s of filters.status) {
    activeChips.push({
      label: `status: ${s}`,
      remove: () => toggleStatus(s),
    });
  }
  for (const r of filters.repo) {
    activeChips.push({
      label: `repo: ${r}`,
      remove: () => toggleRepo(r),
    });
  }
  for (const b of filters.branch) {
    activeChips.push({
      label: `branch: ${b}`,
      remove: () => toggleBranch(b),
    });
  }
  if (filters.from) {
    activeChips.push({
      label: `from: ${filters.from}`,
      remove: () => onChange({ ...filters, from: "" }),
    });
  }
  if (filters.to) {
    activeChips.push({
      label: `to: ${filters.to}`,
      remove: () => onChange({ ...filters, to: "" }),
    });
  }
  return (
    <div>
      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <ActiveChip
              key={chip.label}
              label={chip.label}
              onRemove={chip.remove}
            />
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-xs text-muted hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mb-3 flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {expanded ? "Hide filters" : "Show filters"}
        {hasActiveFilters && !expanded && (
          <span className="ml-1 rounded-full bg-accent/20 px-1.5 text-accent">
            {activeChips.length}
          </span>
        )}
      </button>

      {/* Expanded filter panel */}
      {expanded && (
        <div className="mb-4 space-y-4 rounded-lg border border-border bg-surface p-4">
          {/* Status */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
              Status
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((s) => (
                <ChipButton
                  key={s}
                  label={s}
                  active={filters.status.includes(s)}
                  onClick={() => toggleStatus(s)}
                />
              ))}
            </div>
          </div>

          {/* Repos */}
          {repos.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
                Repository
              </label>
              <div className="flex flex-wrap gap-1.5">
                {repos.map((r) => (
                  <ChipButton
                    key={r}
                    label={r}
                    active={filters.repo.includes(r)}
                    onClick={() => toggleRepo(r)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Branches */}
          {branches.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
                Branch
              </label>
              <div className="flex flex-wrap gap-1.5">
                {branches.map((b) => (
                  <ChipButton
                    key={b}
                    label={b}
                    active={filters.branch.includes(b)}
                    onClick={() => toggleBranch(b)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Date range */}
          <div className="flex gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
                From date
              </label>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => onChange({ ...filters, from: e.target.value })}
                className="h-8 rounded border border-border bg-surface-2 px-2 text-xs text-foreground focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
                To date
              </label>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => onChange({ ...filters, to: e.target.value })}
                className="h-8 rounded border border-border bg-surface-2 px-2 text-xs text-foreground focus:border-accent focus:outline-none"
              />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
