import type { Metadata } from "next";
import { listPolicies, getPolicyStats } from "@agentops/db";
import { db } from "@/lib/db";
import { PoliciesList } from "./PoliciesList";

export const metadata: Metadata = {
  title: "Policies",
  description: "Configure and manage governance policies for agent runs",
};

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
      {policies.length === 0 ? (
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
          <p className="text-xs text-muted mt-1">
            Create your first policy to start governing agent runs.
          </p>
        </div>
      ) : (
        <PoliciesList policies={JSON.parse(JSON.stringify(policiesWithStats))} />
      )}
    </div>
  );
}
