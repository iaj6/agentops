"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Run } from "@agentops/core";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "runs", label: "Go to Runs", description: "View all agent runs", href: "/", icon: "R" },
  { id: "analytics", label: "Go to Analytics", description: "View charts and metrics", href: "/analytics", icon: "A" },
  { id: "policies", label: "Go to Policies", description: "Manage safety policies", href: "/policies", icon: "P" },
  { id: "create-policy", label: "Create Policy", description: "Create a new policy", href: "/policies/new", icon: "+" },
  { id: "settings", label: "Go to Settings", description: "Application settings", href: "/settings", icon: "S" },
];

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Filter quick actions
  const filteredActions = query
    ? QUICK_ACTIONS.filter(
        (a) =>
          a.label.toLowerCase().includes(query.toLowerCase()) ||
          a.description.toLowerCase().includes(query.toLowerCase())
      )
    : QUICK_ACTIONS;

  const totalItems = filteredActions.length + results.length;

  // Search runs on query change
  const searchRuns = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/runs/search?q=${encodeURIComponent(q)}&limit=8`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.runs ?? []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchRuns(query), 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, open, searchRuns]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, totalItems - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Navigate to selected item
        if (selectedIndex < filteredActions.length) {
          const action = filteredActions[selectedIndex];
          router.push(action.href);
          onClose();
        } else {
          const runIdx = selectedIndex - filteredActions.length;
          if (runIdx < results.length) {
            router.push(`/runs/${results[runIdx].id}`);
            onClose();
          }
        }
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, selectedIndex, totalItems, filteredActions, results, router]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions.length, results.length]);

  if (!open) return null;

  function truncateGoal(text: string, max: number) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Palette */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Search input */}
        <div className="flex items-center border-b border-border px-4">
          <svg
            className="mr-3 text-muted"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search runs, navigate..."
            className="h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {/* Quick actions */}
          {filteredActions.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                Quick Actions
              </div>
              {filteredActions.map((action, i) => (
                <button
                  key={action.id}
                  type="button"
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    selectedIndex === i
                      ? "bg-accent/10 text-accent"
                      : "text-foreground hover:bg-surface-2"
                  }`}
                  onClick={() => {
                    router.push(action.href);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-xs font-medium text-muted">
                    {action.icon}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{action.label}</div>
                    <div className="text-xs text-muted">{action.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Run results */}
          {loading && (
            <div className="px-4 py-3 text-xs text-muted">Searching...</div>
          )}
          {!loading && results.length > 0 && (
            <div>
              <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                Runs
              </div>
              {results.map((run, i) => {
                const idx = filteredActions.length + i;
                return (
                  <button
                    key={run.id as string}
                    type="button"
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                      selectedIndex === idx
                        ? "bg-accent/10 text-accent"
                        : "text-foreground hover:bg-surface-2"
                    }`}
                    onClick={() => {
                      router.push(`/runs/${run.id}`);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md border text-xs font-medium ${
                        run.status === "completed"
                          ? "border-green/30 bg-green/10 text-green"
                          : run.status === "failed"
                          ? "border-red/30 bg-red/10 text-red"
                          : run.status === "running"
                          ? "border-accent/30 bg-accent/10 text-accent"
                          : "border-border bg-surface-2 text-muted"
                      }`}
                    >
                      {run.status === "completed"
                        ? "OK"
                        : run.status === "failed"
                        ? "!!"
                        : run.status === "running"
                        ? ">>"
                        : "--"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {truncateGoal(run.goal.humanReadable, 55)}
                      </div>
                      <div className="text-xs text-muted">
                        {run.environment.repo} / {run.environment.branch} &middot;{" "}
                        {(run.id as string).slice(0, 8)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && query && results.length === 0 && filteredActions.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted">
              No results found for &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted">
          <span>
            <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5">Up</kbd>{" "}
            <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5">Down</kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5">Enter</kbd>{" "}
            select
          </span>
          <span>
            <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5">Esc</kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}
