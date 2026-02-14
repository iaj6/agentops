"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/useToast";

const POLICY_TYPES = [
  { value: "pathRestriction", label: "Path Restriction", description: "Block edits to specific paths" },
  { value: "fileLimitCount", label: "File Limit Count", description: "Limit number of files changed" },
  { value: "costCeiling", label: "Cost Ceiling", description: "Cap spending per run" },
  { value: "requiredApproval", label: "Required Approval", description: "Require sign-off from specified roles" },
  { value: "testEnforcement", label: "Test Enforcement", description: "Require passing tests" },
  { value: "riskyOpFlag", label: "Risky Op Flag", description: "Flag dangerous operations" },
] as const;

const SEVERITIES = [
  { value: "error", label: "Error", color: "bg-red/15 text-red border-red/30" },
  { value: "warning", label: "Warning", color: "bg-yellow/15 text-yellow border-yellow/30" },
  { value: "info", label: "Info", color: "bg-blue/15 text-blue border-blue/30" },
] as const;

export function CreatePolicyForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("");
  const [severity, setSeverity] = useState("error");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config fields
  const [blockedPaths, setBlockedPaths] = useState("");
  const [maxFiles, setMaxFiles] = useState(20);
  const [maxCostUsd, setMaxCostUsd] = useState(5);
  const [approvers, setApprovers] = useState("");
  const [requirePassing, setRequirePassing] = useState(true);
  const [minCoverage, setMinCoverage] = useState(80);
  const [riskyPatterns, setRiskyPatterns] = useState("");

  function buildConfig() {
    switch (type) {
      case "pathRestriction":
        return {
          type: "pathRestriction",
          blockedPaths: blockedPaths.split(",").map((s) => s.trim()).filter(Boolean),
        };
      case "fileLimitCount":
        return { type: "fileLimitCount", maxFiles };
      case "costCeiling":
        return { type: "costCeiling", maxCostUsd };
      case "requiredApproval":
        return {
          type: "requiredApproval",
          approvers: approvers.split(",").map((s) => s.trim()).filter(Boolean),
        };
      case "testEnforcement":
        return { type: "testEnforcement", requirePassing, minCoverage };
      case "riskyOpFlag":
        return {
          type: "riskyOpFlag",
          riskyPatterns: riskyPatterns.split(",").map((s) => s.trim()).filter(Boolean),
        };
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
    if (!type) {
      setError("Policy type is required");
      return;
    }

    const config = buildConfig();
    if (!config) {
      setError("Invalid policy configuration");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, config, severity }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create policy");
      }

      toast("Policy created successfully", "success");
      router.refresh();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create policy";
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
          <h2 className="text-lg font-semibold text-foreground">Create Policy</h2>
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
              placeholder="e.g. Block infrastructure changes"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
              Policy Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Select a type...</option>
              {POLICY_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>
                  {pt.label} - {pt.description}
                </option>
              ))}
            </select>
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
          {type && (
            <div className="rounded-md border border-border bg-surface-2 p-4 space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
                Configuration
              </h3>

              {type === "pathRestriction" && (
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

              {type === "fileLimitCount" && (
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

              {type === "costCeiling" && (
                <div>
                  <label className="block text-xs text-muted mb-1">
                    Maximum cost (USD)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted">$</span>
                    <input
                      type="number"
                      value={maxCostUsd}
                      onChange={(e) => setMaxCostUsd(Number(e.target.value))}
                      min={0.01}
                      step={0.01}
                      className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              {type === "requiredApproval" && (
                <div>
                  <label className="block text-xs text-muted mb-1">
                    Required approver roles (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={approvers}
                    onChange={(e) => setApprovers(e.target.value)}
                    placeholder="security-team, platform-lead"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}

              {type === "testEnforcement" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requirePassing}
                      onChange={(e) => setRequirePassing(e.target.checked)}
                      className="rounded border-border accent-accent"
                    />
                    Require all tests passing
                  </label>
                  <div>
                    <label className="block text-xs text-muted mb-1">
                      Minimum coverage (%)
                    </label>
                    <input
                      type="number"
                      value={minCoverage}
                      onChange={(e) => setMinCoverage(Number(e.target.value))}
                      min={0}
                      max={100}
                      className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              )}

              {type === "riskyOpFlag" && (
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
            </div>
          )}

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
              {submitting ? "Creating..." : "Create Policy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
