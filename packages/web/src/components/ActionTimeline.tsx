"use client";

import { useState } from "react";
import type { Action } from "@agentops/core";

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

function getActionSummary(action: Action): {
  icon: "file" | "command" | "tool";
  label: string;
  count: number;
} {
  if (action.fileEdits.length > 0) {
    return { icon: "file", label: "File Edit", count: action.fileEdits.length };
  }
  if (action.commands.length > 0) {
    return { icon: "command", label: "Command", count: action.commands.length };
  }
  if (action.toolCalls.length > 0) {
    return { icon: "tool", label: "Tool Call", count: action.toolCalls.length };
  }
  return { icon: "tool", label: "Action", count: 0 };
}

function ActionIcon({ type }: { type: "file" | "command" | "tool" }) {
  if (type === "file") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-orange">
        <path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (type === "command") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-green">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 7l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-cyan">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ActionTimeline({ actions }: { actions: readonly Action[] }) {
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());

  function toggle(index: number) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  if (actions.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No actions recorded.</p>
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      {actions.map((action, i) => {
        const summary = getActionSummary(action);
        const expanded = expandedSet.has(i);

        // Calculate duration if we have a next action
        let duration: string | null = null;
        if (i < actions.length - 1) {
          const ms =
            new Date(actions[i + 1].timestamp).getTime() -
            new Date(action.timestamp).getTime();
          if (ms >= 1000) {
            const sec = Math.floor(ms / 1000);
            duration = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
          } else {
            duration = `${ms}ms`;
          }
        }

        return (
          <div key={action.id as string} className="relative mb-3">
            {/* Timeline dot */}
            <div className="absolute -left-6 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface">
              <ActionIcon type={summary.icon} />
            </div>

            {/* Card */}
            <button
              onClick={() => toggle(i)}
              className="w-full text-left rounded-lg border border-border bg-surface transition-colors hover:bg-surface-2"
            >
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                  #{i + 1}
                </span>
                <span className="text-sm text-foreground">{summary.label}</span>
                {summary.count > 0 && (
                  <span className="text-xs text-muted">({summary.count})</span>
                )}
                <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                  {duration && (
                    <span className="font-mono">{duration}</span>
                  )}
                  <span>{formatTime(action.timestamp)}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                    fill="none"
                  >
                    <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
              </div>
            </button>

            {/* Expanded details */}
            {expanded && (
              <div className="mt-1 rounded-lg border border-border bg-surface p-4 space-y-3">
                {action.toolCalls.length > 0 && (
                  <div>
                    <h5 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                      Tool Calls
                    </h5>
                    {action.toolCalls.map((tc, j) => (
                      <div key={j} className="mb-2 rounded bg-surface-2 p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-cyan">{tc.name}</span>
                          <span className="text-xs text-muted">
                            {formatTime(tc.timestamp)}
                          </span>
                        </div>
                        <pre className="mt-1 overflow-x-auto text-xs text-muted">
                          {JSON.stringify(tc.input, null, 2)}
                        </pre>
                        {tc.output && (
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-foreground">
                            {tc.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {action.fileEdits.length > 0 && (
                  <div>
                    <h5 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                      File Edits
                    </h5>
                    {action.fileEdits.map((edit, j) => (
                      <div key={j} className="mb-2 rounded bg-surface-2 p-3">
                        <div className="font-mono text-sm text-orange">{edit.path}</div>
                        <pre className="mt-1 max-h-60 overflow-auto rounded bg-background p-2 text-xs text-foreground">
                          {edit.diff}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                {action.commands.length > 0 && (
                  <div>
                    <h5 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                      Commands
                    </h5>
                    {action.commands.map((cmd, j) => (
                      <div key={j} className="mb-2 rounded bg-surface-2 p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-foreground">$ {cmd.command}</span>
                          <span
                            className={`ml-auto rounded px-1.5 py-0.5 text-xs font-mono ${
                              cmd.exitCode === 0
                                ? "bg-green/15 text-green"
                                : "bg-red/15 text-red"
                            }`}
                          >
                            exit {cmd.exitCode}
                          </span>
                        </div>
                        {cmd.stdout && (
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-green/80">
                            {cmd.stdout}
                          </pre>
                        )}
                        {cmd.stderr && (
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-xs text-red/80">
                            {cmd.stderr}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
