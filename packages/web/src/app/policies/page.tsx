import { listPolicies, getPolicyStats } from "@agentops/db";
import { db } from "@/lib/db";
import { PoliciesList } from "./PoliciesList";

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  const database = db();
  const policies = listPolicies(database);

  const policiesWithStats = policies.map((policy) => {
    const stats = getPolicyStats(database, policy.id);
    return { ...policy, stats };
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Policies</h1>
        <p className="text-sm text-muted">
          {policies.length} polic{policies.length !== 1 ? "ies" : "y"} configured
        </p>
      </div>
      <PoliciesList policies={JSON.parse(JSON.stringify(policiesWithStats))} />
    </div>
  );
}
