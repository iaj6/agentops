"use client";

import type { Policy, PolicySeverity } from "@agentops/core";

type PolicyWithMeta = Policy & { enabled: boolean; createdAt: string };

const severityColors: Record<string, string> = {
  error: "bg-red/15 text-red border-red/30",
  warning: "bg-yellow/15 text-yellow border-yellow/30",
  info: "bg-blue/15 text-blue border-blue/30",
};

export function PoliciesList({ policies }: { policies: PolicyWithMeta[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wider text-muted">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Config</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr
              key={policy.id as string}
              className="border-b border-border transition-colors hover:bg-surface-2"
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
              <td className="max-w-xs px-4 py-3 font-mono text-xs text-muted truncate">
                {JSON.stringify(policy.config)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    policy.enabled
                      ? "bg-green/15 text-green"
                      : "bg-muted/15 text-muted"
                  }`}
                >
                  {policy.enabled ? "Enabled" : "Disabled"}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(policy.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
