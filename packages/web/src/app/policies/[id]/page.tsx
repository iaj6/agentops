import { getPolicy, getPolicyStats, getPolicyResultsForPolicy } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PolicyDetail } from "./PolicyDetail";

export const dynamic = "force-dynamic";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = db();
  const policy = getPolicy(database, createPolicyId(id));

  if (!policy) notFound();

  const stats = getPolicyStats(database, policy.id);
  const results = getPolicyResultsForPolicy(database, policy.id);

  return (
    <PolicyDetail
      policy={JSON.parse(JSON.stringify(policy))}
      stats={stats}
      results={JSON.parse(JSON.stringify(results))}
    />
  );
}
