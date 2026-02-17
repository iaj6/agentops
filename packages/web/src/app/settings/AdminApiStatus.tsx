"use client";

import { useAdminStatus } from "@/hooks/useAdminApi";

export function AdminApiStatus() {
  const { configured, loading } = useAdminStatus();

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground mb-1">
        Anthropic Admin API
      </h2>
      <p className="text-xs text-muted mb-4">
        Connect to the Anthropic Admin API to view usage and cost data on the
        Usage page.
      </p>

      {loading ? (
        <div className="rounded bg-surface-2 p-3 text-xs text-muted">
          Checking configuration...
        </div>
      ) : configured ? (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs font-medium text-green-400">Connected</span>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block h-2 w-2 rounded-full bg-[#555]" />
            <span className="text-xs font-medium text-muted">
              Not configured
            </span>
          </div>
          <p className="text-xs text-muted mb-2">
            Set the{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
              ANTHROPIC_ADMIN_API_KEY
            </code>{" "}
            environment variable before starting the dashboard:
          </p>
          <div className="rounded bg-surface-2 p-3 font-mono text-xs text-muted">
            export ANTHROPIC_ADMIN_API_KEY=&quot;sk-ant-admin-...&quot;
          </div>
        </div>
      )}
    </div>
  );
}
