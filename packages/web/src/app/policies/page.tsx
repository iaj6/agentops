import { listPolicies } from "@agentops/db";
import { db } from "@/lib/db";
import { PoliciesList } from "./PoliciesList";

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  const policies = listPolicies(db());

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Policies</h1>
        <p className="text-sm text-muted">
          {policies.length} polic{policies.length !== 1 ? "ies" : "y"} configured
        </p>
      </div>
      {policies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <p className="text-sm font-medium text-foreground">No policies configured</p>
          <p className="text-xs text-muted mt-1">
            Add policies via the CLI to enforce guardrails on agent runs.
          </p>
        </div>
      ) : (
        <PoliciesList policies={JSON.parse(JSON.stringify(policies))} />
      )}
    </div>
  );
}
