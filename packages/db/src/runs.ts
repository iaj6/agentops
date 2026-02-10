import { eq, and, desc, asc, gte, lte, inArray, sql, count } from "drizzle-orm";
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

export interface SearchRunsFilters {
  q?: string;
  status?: string[];
  repo?: string[];
  branch?: string[];
  from?: string;
  to?: string;
  minCost?: number;
  maxCost?: number;
  sortBy?: "status" | "cost" | "duration" | "created" | "score";
  sortDir?: "asc" | "desc";
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
      github: (run.github as unknown as Record<string, unknown>) ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })
    .run();
}

function rowToRun(row: typeof runs.$inferSelect): Run {
  const env = row.environment as unknown as Run["environment"];
  const github = row.github as unknown as Run["github"] | null;
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
    ...(github ? { github } : {}),
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
  if (updates.github !== undefined) values["github"] = updates.github ?? null;
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

function buildSearchConditions(filters: SearchRunsFilters) {
  const conditions = [];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      sql`(
        ${runs.goal} LIKE ${pattern}
        OR ${runs.repo} LIKE ${pattern}
        OR ${runs.branch} LIKE ${pattern}
        OR ${runs.agents} LIKE ${pattern}
        OR ${runs.actions} LIKE ${pattern}
      )`
    );
  }

  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(runs.status, filters.status));
  }

  if (filters.repo && filters.repo.length > 0) {
    conditions.push(inArray(runs.repo, filters.repo));
  }

  if (filters.branch && filters.branch.length > 0) {
    conditions.push(inArray(runs.branch, filters.branch));
  }

  if (filters.from) {
    conditions.push(gte(runs.createdAt, filters.from));
  }

  if (filters.to) {
    conditions.push(lte(runs.createdAt, filters.to));
  }

  return conditions;
}

export function searchRuns(db: AgentOpsDb, filters: SearchRunsFilters): Run[] {
  const conditions = buildSearchConditions(filters);

  const sortCol = {
    status: runs.status,
    cost: sql`json_extract(${runs.metrics}, '$.costUsd')`,
    duration: sql`json_extract(${runs.metrics}, '$.wallTimeMs')`,
    created: runs.createdAt,
    score: sql`json_extract(${runs.evaluations}, '$[0].confidenceScore')`,
  }[filters.sortBy ?? "created"] ?? runs.createdAt;

  const direction = filters.sortDir === "asc" ? asc : desc;

  let query = db
    .select()
    .from(runs)
    .orderBy(direction(sortCol))
    .$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  query = query.limit(filters.limit ?? 50);
  if (filters.offset) {
    query = query.offset(filters.offset);
  }

  const rows = query.all();

  // Post-filter by cost range (metrics is JSON)
  let results = rows.map(rowToRun);
  if (filters.minCost !== undefined) {
    results = results.filter((r) => r.metrics.costUsd >= filters.minCost!);
  }
  if (filters.maxCost !== undefined) {
    results = results.filter((r) => r.metrics.costUsd <= filters.maxCost!);
  }

  return results;
}

export function countRuns(db: AgentOpsDb, filters: SearchRunsFilters): number {
  const conditions = buildSearchConditions(filters);

  let query = db
    .select({ total: count() })
    .from(runs)
    .$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const row = query.get();
  return row?.total ?? 0;
}

export function getDistinctRepos(db: AgentOpsDb): string[] {
  const rows = db
    .selectDistinct({ repo: runs.repo })
    .from(runs)
    .orderBy(asc(runs.repo))
    .all();
  return rows.map((r) => r.repo);
}

export function getDistinctBranches(db: AgentOpsDb): string[] {
  const rows = db
    .selectDistinct({ branch: runs.branch })
    .from(runs)
    .orderBy(asc(runs.branch))
    .all();
  return rows.map((r) => r.branch);
}
