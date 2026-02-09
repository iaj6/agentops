import { eq, and, desc } from "drizzle-orm";
import type { Run, RunId, Metrics } from "@agentops/core";
import { createRunId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { runs, runMetrics } from "./schema.js";

interface ListRunsFilters {
  status?: string;
  repo?: string;
  branch?: string;
  limit?: number;
  offset?: number;
}

export function insertRun(db: AgentOpsDb, run: Run): void {
  db.insert(runs)
    .values({
      id: run.id as string,
      status: run.status,
      goal: run.goal,
      agents: run.agents as unknown as Record<string, unknown>,
      environment: run.environment as unknown as Record<string, unknown>,
      repo: run.environment.repo,
      branch: run.environment.branch,
      actions: run.actions as unknown as Record<string, unknown>,
      artifacts: run.artifacts as unknown as Record<string, unknown>,
      metrics: run.metrics as unknown as Record<string, unknown>,
      evaluations: run.evaluations as unknown as Record<string, unknown>,
      decisions: run.decisions as unknown as Record<string, unknown>,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })
    .run();
}

function rowToRun(row: typeof runs.$inferSelect): Run {
  const env = row.environment as unknown as Run["environment"];
  return {
    id: createRunId(row.id),
    status: row.status as Run["status"],
    goal: row.goal as unknown as Run["goal"],
    agents: row.agents as unknown as Run["agents"],
    environment: env,
    actions: row.actions as unknown as Run["actions"],
    artifacts: row.artifacts as unknown as Run["artifacts"],
    metrics: row.metrics as unknown as Run["metrics"],
    evaluations: row.evaluations as unknown as Run["evaluations"],
    decisions: row.decisions as unknown as Run["decisions"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getRun(db: AgentOpsDb, id: RunId): Run | null {
  const row = db.select().from(runs).where(eq(runs.id, id as string)).get();
  if (!row) return null;
  return rowToRun(row);
}

export function listRuns(db: AgentOpsDb, filters?: ListRunsFilters): Run[] {
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(runs.status, filters.status));
  }
  if (filters?.repo) {
    conditions.push(eq(runs.repo, filters.repo));
  }
  if (filters?.branch) {
    conditions.push(eq(runs.branch, filters.branch));
  }

  let query = db
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  const rows = query.all();
  return rows.map(rowToRun);
}

export function updateRun(
  db: AgentOpsDb,
  id: RunId,
  updates: Partial<Run>,
): void {
  const values: Record<string, unknown> = {};

  if (updates.status !== undefined) values["status"] = updates.status;
  if (updates.goal !== undefined) values["goal"] = updates.goal;
  if (updates.agents !== undefined) values["agents"] = updates.agents;
  if (updates.environment !== undefined) {
    values["environment"] = updates.environment;
    values["repo"] = updates.environment.repo;
    values["branch"] = updates.environment.branch;
  }
  if (updates.actions !== undefined) values["actions"] = updates.actions;
  if (updates.artifacts !== undefined) values["artifacts"] = updates.artifacts;
  if (updates.metrics !== undefined) values["metrics"] = updates.metrics;
  if (updates.evaluations !== undefined)
    values["evaluations"] = updates.evaluations;
  if (updates.decisions !== undefined) values["decisions"] = updates.decisions;
  if (updates.updatedAt !== undefined) values["updatedAt"] = updates.updatedAt;

  if (Object.keys(values).length > 0) {
    db.update(runs).set(values).where(eq(runs.id, id as string)).run();
  }
}

export function getRunMetrics(
  db: AgentOpsDb,
  id: RunId,
): Metrics | null {
  const row = db
    .select()
    .from(runMetrics)
    .where(eq(runMetrics.runId, id as string))
    .get();
  if (!row) return null;

  const tokenUsage = row.tokenUsage as unknown as Metrics["tokenUsage"];
  return {
    tokenUsage,
    wallTimeMs: row.wallTimeMs,
    costUsd: row.costCents / 100,
    flakeRate: row.flakeRate,
  };
}
