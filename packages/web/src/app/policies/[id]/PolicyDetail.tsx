"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PolicyType, PolicyMode, getPolicyMode } from "@agentops/core";
import type { Policy, PolicySeverity } from "@agentops/core";
import { MetricCard } from "@/components/MetricCard";
import { toast } from "@/hooks/useToast";

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

const SEVERITIES = [
  { value: "error", label: "Error", color: "bg-red/15 text-red border-red/30" },
  { value: "warning", label: "Warning", color: "bg-yellow/15 text-yellow border-yellow/30" },
  { value: "info", label: "Info", color: "bg-blue/15 text-blue border-blue/30" },
] as const;

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

function EditPolicyForm({
  policy,
  onClose,
}: {
  policy: PolicyWithMeta;
  onClose: () => void;
}) {
  const router = useRouter();
  const config = policy.config as unknown as Record<string, unknown>;
  const policyType = config.type as string;

  const [name, setName] = useState(policy.name);
  const [severity, setSeverity] = useState(policy.severity as string);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config fields - initialize from current config
  const [blockedPaths, setBlockedPaths] = useState(
    policyType === "pathRestriction" ? (config.blockedPaths as string[]).join(", ") : "",
  );
  const [maxFiles, setMaxFiles] = useState(
    policyType === "fileLimitCount" ? (config.maxFiles as number) : 20,
  );
  const [riskyPatterns, setRiskyPatterns] = useState(
    policyType === "riskyOpFlag" ? (config.riskyPatterns as string[]).join(", ") : "",
  );
  const [maxUsd, setMaxUsd] = useState(
    policyType === "costCeiling" ? (config.maxUsd as number) : 25,
  );

  function buildConfig() {
    switch (policyType) {
      case "pathRestriction":
        return {
          type: "pathRestriction",
          blockedPaths: blockedPaths.split(",").map((s) => s.trim()).filter(Boolean),
        };
      case "fileLimitCount":
        return { type: "fileLimitCount", maxFiles };
      case "riskyOpFlag":
        return {
          type: "riskyOpFlag",
          riskyPatterns: riskyPatterns.split(",").map((s) => s.trim()).filter(Boolean),
        };
      case "costCeiling":
        return { type: "costCeiling", maxUsd };
      default:
        return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    const newConfig = buildConfig();
    if (!newConfig) {
      setError("Invalid policy configuration");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/policies/${policy.id as string}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: newConfig, severity }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update policy");
      }

      toast("Policy updated successfully", "success");
      router.refresh();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update policy";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Edit Policy</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-md bg-red/10 border border-red/20 px-4 py-3 text-sm text-red">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Policy Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Type (read-only) */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Policy Type
            </label>
            <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted font-mono">
              {policyType}
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Severity
            </label>
            <div className="flex gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    severity === s.value
                      ? s.color
                      : "border-border text-muted hover:border-muted"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Config */}
          <div className="rounded-md border border-border bg-surface-2 p-4 space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
              Configuration
            </h3>

            {policyType === "pathRestriction" && (
              <div>
                <label className="block text-xs text-muted mb-1">
                  Forbidden paths (comma-separated)
                </label>
                <input
                  type="text"
                  value={blockedPaths}
                  onChange={(e) => setBlockedPaths(e.target.value)}
                  placeholder="/infra/, terraform/, .github/workflows/"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {policyType === "fileLimitCount" && (
              <div>
                <label className="block text-xs text-muted mb-1">
                  Maximum files allowed
                </label>
                <input
                  type="number"
                  value={maxFiles}
                  onChange={(e) => setMaxFiles(Number(e.target.value))}
                  min={1}
                  className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {policyType === "riskyOpFlag" && (
              <div>
                <label className="block text-xs text-muted mb-1">
                  Risky operation patterns (comma-separated)
                </label>
                <input
                  type="text"
                  value={riskyPatterns}
                  onChange={(e) => setRiskyPatterns(e.target.value)}
                  placeholder="rm -rf, git push --force, DROP TABLE"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {policyType === "costCeiling" && (
              <div>
                <label className="block text-xs text-muted mb-1">
                  Maximum session cost (USD)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">$</span>
                  <input
                    type="number"
                    value={maxUsd}
                    onChange={(e) => setMaxUsd(Number(e.target.value))}
                    min={0}
                    step={0.5}
                    className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
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
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        toast(`Policy ${!enabled ? "enabled" : "disabled"}`, "success");
        router.refresh();
      } else {
        toast("Failed to toggle policy", "error");
      }
    } catch {
      toast("Failed to toggle policy", "error");
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    setShowDeleteConfirm(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/policies/${policy.id as string}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Policy deleted", "success");
        router.push("/policies");
        router.refresh();
      } else {
        toast("Failed to delete policy", "error");
      }
    } catch {
      toast("Failed to delete policy", "error");
    } finally {
      setDeleting(false);
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
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowEdit(true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleting}
              className="rounded-md border border-red/30 px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm text-muted font-mono">{policy.type}</span>
          {(() => {
            const knownTypes = new Set(Object.values(PolicyType) as string[]);
            if (!knownTypes.has(policy.type)) {
              return (
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-muted/15 text-muted border-muted/30">
                  deprecated
                </span>
              );
            }
            const mode = getPolicyMode(policy.type as PolicyType);
            const isGuard = mode === PolicyMode.Guard;
            return (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  isGuard
                    ? "bg-green/15 text-green border-green/30"
                    : "bg-blue/15 text-blue border-blue/30"
                }`}
              >
                {isGuard ? "Guard" : "Check"}
              </span>
            );
          })()}
        </div>
        <p className="mt-1 text-xs text-muted">
          {(() => {
            const knownTypes = new Set(Object.values(PolicyType) as string[]);
            if (!knownTypes.has(policy.type)) return "This policy type is no longer supported.";
            const mode = getPolicyMode(policy.type as PolicyType);
            return mode === PolicyMode.Guard
              ? "This policy blocks tool calls in real-time."
              : "This policy evaluates after the run completes.";
          })()}
        </p>
        <p className="mt-1 text-xs text-muted">
          Created {new Date(policy.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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

      {/* Edit modal */}
      {showEdit && (
        <EditPolicyForm policy={policy} onClose={() => setShowEdit(false)} />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-xl p-6">
            <h3 className="text-sm font-semibold text-foreground mb-2">Delete Policy</h3>
            <p className="text-sm text-muted mb-6">
              Are you sure you want to delete &ldquo;{policy.name}&rdquo;? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-md bg-red px-4 py-2 text-sm font-medium text-white hover:bg-red/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
