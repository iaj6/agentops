"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PolicyType, PolicyMode, getPolicyMode } from "@agentops/core";
import type { Policy } from "@agentops/core";
import { toast } from "@/hooks/useToast";
import { summarizePolicyConfig } from "@/lib/policy-summary";
import { CreatePolicyForm } from "./CreatePolicyForm";

type PolicyWithMeta = Policy & {
  enabled: boolean;
  createdAt: string;
  stats: { total: number; passed: number; failed: number };
};

const severityColors: Record<string, string> = {
  error: "bg-red/15 text-red border-red/30",
  warning: "bg-yellow/15 text-yellow border-yellow/30",
  info: "bg-blue/15 text-blue border-blue/30",
};

function ToggleSwitch({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
        enabled ? "bg-green" : "bg-muted/30"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red px-4 py-2 text-sm font-medium text-white hover:bg-red/90 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PoliciesList({
  policies,
  isAdmin = false,
}: {
  policies: PolicyWithMeta[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loadingStarters, setLoadingStarters] = useState(false);

  async function handleLoadStarters() {
    setLoadingStarters(true);
    try {
      const res = await fetch("/api/policies/load-starters", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as {
          inserted: string[];
          skipped: string[];
        };
        const ins = data.inserted.length;
        const skp = data.skipped.length;
        if (ins > 0 && skp === 0) {
          toast(`Installed ${ins} starter polic${ins === 1 ? "y" : "ies"}`, "success");
        } else if (ins > 0 && skp > 0) {
          toast(`Installed ${ins}, ${skp} already present`, "success");
        } else {
          toast("All starter policies already present", "info");
        }
        router.refresh();
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast(body.error ?? "Failed to load starter policies", "error");
      }
    } catch {
      toast("Failed to load starter policies", "error");
    } finally {
      setLoadingStarters(false);
    }
  }

  async function handleToggle(policyId: string, currentEnabled: boolean) {
    setToggling(policyId);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        toast(
          `Policy ${!currentEnabled ? "enabled" : "disabled"}`,
          "success",
        );
      } else {
        toast("Failed to toggle policy", "error");
      }
      router.refresh();
    } catch {
      toast("Failed to toggle policy", "error");
    } finally {
      setToggling(null);
    }
  }

  async function handleDelete(policyId: string) {
    setConfirmDelete(null);
    setDeletingId(policyId);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Policy deleted", "success");
      } else {
        toast("Failed to delete policy", "error");
      }
      router.refresh();
    } catch {
      toast("Failed to delete policy", "error");
    } finally {
      setDeletingId(null);
    }
  }

  if (policies.length === 0 && !showCreate) {
    return (
      <>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <div className="text-4xl text-muted mb-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M24 4L8 12v12c0 10.5 7.5 16.5 16 21 8.5-4.5 16-10.5 16-21V12L24 4z"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">No policies configured</p>
          <p className="text-xs text-muted mt-1 mb-4">
            Create your first policy to start governing agent runs.
          </p>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={handleLoadStarters}
                disabled={loadingStarters}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
                title="Install a curated set of 7 sensible defaults (cost ceiling, branch protection, secrets, risky ops, tool restriction, file count)"
              >
                {loadingStarters ? "Loading..." : "Load starter policies"}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              Create Policy
            </button>
          </div>
        </div>
        {showCreate && <CreatePolicyForm onClose={() => setShowCreate(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted">
            {policies.filter((p) => p.enabled).length} of {policies.length} enabled
          </span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          Create Policy
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Pass / Fail</th>
              <th className="px-4 py-3">Config</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr
                key={policy.id as string}
                onClick={() => router.push(`/policies/${policy.id as string}`)}
                className="border-b border-border transition-colors hover:bg-surface-2 cursor-pointer"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {policy.name}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  {policy.type}
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const knownTypes = new Set(Object.values(PolicyType) as string[]);
                    if (!knownTypes.has(policy.type)) {
                      return (
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-muted/15 text-muted border-muted/30"
                          title="This policy type is no longer supported"
                        >
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
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      severityColors[policy.severity] ?? "bg-muted/15 text-muted border-muted/30"
                    }`}
                  >
                    {policy.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {policy.stats.total > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="bg-green"
                          style={{
                            width: `${(policy.stats.passed / policy.stats.total) * 100}%`,
                          }}
                        />
                        <div
                          className="bg-red"
                          style={{
                            width: `${(policy.stats.failed / policy.stats.total) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted whitespace-nowrap">
                        <span className="text-green">{policy.stats.passed}</span>
                        {" / "}
                        <span className="text-red">{policy.stats.failed}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">No data</span>
                  )}
                </td>
                <td
                  className="max-w-xs px-4 py-3 text-xs text-muted truncate"
                  title={JSON.stringify(policy.config, null, 2)}
                >
                  {summarizePolicyConfig(policy.config)}
                </td>
                <td className="px-4 py-3">
                  <ToggleSwitch
                    enabled={policy.enabled}
                    onToggle={() =>
                      handleToggle(policy.id as string, policy.enabled)
                    }
                    disabled={toggling === (policy.id as string)}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(policy.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(policy.id as string);
                    }}
                    disabled={deletingId === (policy.id as string)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-red hover:bg-red/10 transition-colors disabled:opacity-50"
                  >
                    {deletingId === (policy.id as string) ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePolicyForm onClose={() => setShowCreate(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Policy"
          message="Are you sure you want to delete this policy? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
