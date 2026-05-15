import { eq, sql } from "drizzle-orm";
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

/**
 * Insert a single policy_result row. Used by:
 *   - Pre-tool guard fires (one row per fire) — the live block trail.
 *   - Run completion (one row per active policy) — the post-run rollup.
 * Both paths share the same shape so the Policy detail page can group
 * by policyId and accumulate the history without distinguishing source.
 */
export function insertPolicyResult(
  db: AgentOpsDb,
  result: {
    id: string;
    runId: string;
    policyId: string;
    passed: boolean;
    message: string;
    details: Record<string, unknown>;
    evaluatedAt: string;
  },
): void {
  db.insert(policyResults)
    .values({
      id: result.id,
      runId: result.runId,
      policyId: result.policyId,
      passed: result.passed,
      message: result.message,
      details: result.details,
      evaluatedAt: result.evaluatedAt,
    })
    .run();
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

export function getPolicy(
  db: AgentOpsDb,
  id: PolicyId,
): (Policy & { enabled: boolean; createdAt: string }) | null {
  const row = db
    .select()
    .from(policies)
    .where(eq(policies.id, id as string))
    .get() as DbPolicy | undefined;

  if (!row) return null;

  return {
    id: createPolicyId(row.id),
    name: row.name,
    type: row.type as Policy["type"],
    config: row.config as Policy["config"],
    severity: row.severity as PolicySeverity,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export function updatePolicy(
  db: AgentOpsDb,
  id: PolicyId,
  updates: {
    name?: string;
    config?: unknown;
    severity?: string;
    enabled?: boolean;
  },
): void {
  const values: Record<string, unknown> = {};
  if (updates.name !== undefined) values["name"] = updates.name;
  if (updates.config !== undefined) values["config"] = updates.config;
  if (updates.severity !== undefined) values["severity"] = updates.severity;
  if (updates.enabled !== undefined) values["enabled"] = updates.enabled;

  if (Object.keys(values).length > 0) {
    db.update(policies).set(values).where(eq(policies.id, id as string)).run();
  }
}

export function getPolicyStats(
  db: AgentOpsDb,
  policyId: PolicyId,
): { total: number; passed: number; failed: number } {
  const rows = db
    .select({
      passed: policyResults.passed,
      count: sql<number>`count(*)`,
    })
    .from(policyResults)
    .where(eq(policyResults.policyId, policyId as string))
    .groupBy(policyResults.passed)
    .all();

  let passed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.passed) {
      passed = Number(row.count);
    } else {
      failed = Number(row.count);
    }
  }

  return { total: passed + failed, passed, failed };
}

export function deletePolicy(
  db: AgentOpsDb,
  id: PolicyId,
): void {
  db.delete(policies).where(eq(policies.id, id as string)).run();
}

export function getPolicyResultsForPolicy(
  db: AgentOpsDb,
  policyId: PolicyId,
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
    .where(eq(policyResults.policyId, policyId as string))
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
