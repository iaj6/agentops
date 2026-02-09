import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";
import { RunsTable } from "./RunsTable";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const runs = listRuns(db(), { limit: 50 });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Runs</h1>
          <p className="text-sm text-muted">
            {runs.length} run{runs.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <div className="text-4xl text-muted mb-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
              <path d="M18 24h12M24 18v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">No runs yet</p>
          <p className="text-xs text-muted mt-1">
            Start an agent run using the CLI to see it here.
          </p>
        </div>
      ) : (
        <RunsTable runs={JSON.parse(JSON.stringify(runs))} />
      )}
    </div>
  );
}
