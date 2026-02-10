"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Policy, PolicySeverity } from "@agentops/core";
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

export function PoliciesList({ policies }: { policies: PolicyWithMeta[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleToggle(policyId: string, currentEnabled: boolean) {
    setToggling(policyId);
    try {
      await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      router.refresh();
    } finally {
      setToggling(null);
    }
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
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Pass / Fail</th>
              <th className="px-4 py-3">Config</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Created</th>
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
                <td className="max-w-xs px-4 py-3 font-mono text-xs text-muted truncate">
                  {JSON.stringify(policy.config)}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreatePolicyForm onClose={() => setShowCreate(false)} />}
    </>
  );
}
