import { eq } from "drizzle-orm";
import type { PolicyId, RunId } from "@agentops/core";
import { createPolicyId } from "@agentops/core";
import type { Policy, PolicySeverity } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { policies, policyResults } from "./schema.js";

interface ListPoliciesFilters {
  type?: string;
  severity?: string;
  enabled?: boolean;
}

interface DbPolicy {
  id: string;
  name: string;
  type: string;
  config: unknown;
  severity: string;
  enabled: boolean;
  createdAt: string;
}

interface DbPolicyResult {
  id: string;
  runId: string;
  policyId: string;
  passed: boolean;
  message: string;
  details: unknown;
  evaluatedAt: string;
}

export function insertPolicy(
  db: AgentOpsDb,
  policy: Policy & { enabled?: boolean; createdAt?: string },
): void {
  db.insert(policies)
    .values({
      id: policy.id as string,
      name: policy.name,
      type: policy.type,
      config: policy.config as unknown as Record<string, unknown>,
      severity: policy.severity,
      enabled: policy.enabled ?? true,
      createdAt: policy.createdAt ?? new Date().toISOString(),
    })
    .run();
}

export function listPolicies(
  db: AgentOpsDb,
  filters?: ListPoliciesFilters,
): Array<
  Policy & { enabled: boolean; createdAt: string }
> {
  let rows: DbPolicy[];
  if (filters?.type) {
    rows = db
      .select()
      .from(policies)
      .where(eq(policies.type, filters.type))
      .all() as DbPolicy[];
  } else if (filters?.enabled !== undefined) {
    rows = db
      .select()
      .from(policies)
      .where(eq(policies.enabled, filters.enabled))
      .all() as DbPolicy[];
  } else {
    rows = db.select().from(policies).all() as DbPolicy[];
  }

  return rows.map((row) => ({
    id: createPolicyId(row.id),
    name: row.name,
    type: row.type as Policy["type"],
    config: row.config as Policy["config"],
    severity: row.severity as PolicySeverity,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }));
}

export function getPolicyResults(
  db: AgentOpsDb,
  runId: RunId,
): Array<{
  id: string;
  runId: string;
  policyId: string;
  passed: boolean;
  message: string;
  details: Record<string, unknown>;
  evaluatedAt: string;
}> {
  const rows = db
    .select()
    .from(policyResults)
    .where(eq(policyResults.runId, runId as string))
    .all() as DbPolicyResult[];

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    policyId: row.policyId,
    passed: row.passed,
    message: row.message,
    details: row.details as Record<string, unknown>,
    evaluatedAt: row.evaluatedAt,
  }));
}
