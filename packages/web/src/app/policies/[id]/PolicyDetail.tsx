"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Policy, PolicySeverity } from "@agentops/core";
import { MetricCard } from "@/components/MetricCard";

type PolicyWithMeta = Policy & { enabled: boolean; createdAt: string };

interface PolicyResult {
  id: string;
  runId: string;
  policyId: string;
  passed: boolean;
  message: string;
  details: Record<string, unknown>;
  evaluatedAt: string;
}

interface Stats {
  total: number;
  passed: number;
  failed: number;
}

const severityColors: Record<string, string> = {
  error: "bg-red/15 text-red border-red/30",
  warning: "bg-yellow/15 text-yellow border-yellow/30",
  info: "bg-blue/15 text-blue border-blue/30",
};

function ConfigDisplay({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config).filter(([key]) => key !== "type");

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start gap-3 text-sm">
          <span className="text-muted min-w-[140px] font-mono text-xs">{key}</span>
          <span className="text-foreground font-mono text-xs">
            {Array.isArray(value)
              ? (value as string[]).join(", ")
              : typeof value === "boolean"
                ? value ? "Yes" : "No"
                : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PolicyDetail({
  policy,
  stats,
  results,
}: {
  policy: PolicyWithMeta;
  stats: Stats;
  results: PolicyResult[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(policy.enabled);
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/policies/${policy.id as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (res.ok) {
        setEnabled(!enabled);
        router.refresh();
      }
    } finally {
      setToggling(false);
    }
  }

  const passRate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : "0";

  // Sort results by date descending
  const sortedResults = [...results].sort(
    (a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime()
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-2">
          <Link
            href="/policies"
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            &larr; Back to Policies
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">{policy.name}</h1>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
              severityColors[policy.severity] ?? "bg-muted/15 text-muted border-muted/30"
            }`}
          >
            {policy.severity}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              enabled ? "bg-green/15 text-green" : "bg-muted/15 text-muted"
            }`}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted font-mono">{policy.type}</p>
        <p className="mt-1 text-xs text-muted">
          Created {new Date(policy.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard label="Total Evaluations" value={String(stats.total)} />
        <MetricCard label="Passed" value={String(stats.passed)} />
        <MetricCard label="Failed" value={String(stats.failed)} />
        <MetricCard label="Pass Rate" value={`${passRate}%`} />
      </div>

      {/* Pass/Fail Bar */}
      {stats.total > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Pass / Fail Distribution
          </h3>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
            <div
              className="bg-green transition-all"
              style={{ width: `${(stats.passed / stats.total) * 100}%` }}
            />
            <div
              className="bg-red transition-all"
              style={{ width: `${(stats.failed / stats.total) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>
              <span className="text-green">{stats.passed} passed</span>
              {" "}({stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(0) : 0}%)
            </span>
            <span>
              <span className="text-red">{stats.failed} failed</span>
              {" "}({stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(0) : 0}%)
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Config */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Configuration
          </h3>
          <ConfigDisplay config={policy.config as unknown as Record<string, unknown>} />
        </div>

        {/* Toggle */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Status
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground font-medium">
                {enabled ? "Policy is active" : "Policy is disabled"}
              </p>
              <p className="text-xs text-muted mt-1">
                {enabled
                  ? "This policy is currently being evaluated against all runs."
                  : "This policy is not being evaluated. Toggle to re-enable."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={toggling}
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                enabled ? "bg-green" : "bg-muted/30"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-[22px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Evaluation Results */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Evaluation History ({results.length})
          </h3>
        </div>
        {sortedResults.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted">No evaluation results yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedResults.map((result) => (
              <div
                key={result.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors cursor-pointer"
                onClick={() => router.push(`/runs/${result.runId}`)}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    result.passed
                      ? "bg-green/15 text-green"
                      : "bg-red/15 text-red"
                  }`}
                >
                  {result.passed ? "\u2713" : "\u2717"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-accent truncate">
                      {result.runId.slice(0, 12)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        result.passed
                          ? "bg-green/15 text-green border border-green/30"
                          : "bg-red/15 text-red border border-red/30"
                      }`}
                    >
                      {result.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5 truncate">{result.message}</p>
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {new Date(result.evaluatedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
