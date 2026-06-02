import { eq, and, desc, asc, gte, lte, lt, inArray, sql, count } from "drizzle-orm";
import type { Run, RunId, Metrics, SessionSummary } from "@agentops/core";
import { createRunId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { runs, runMetrics, policyResults, events } from "./schema.js";

interface ListRunsFilters {
  status?: string;
  repo?: string;
  branch?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface SearchRunsFilters {
  q?: string;
  status?: string[];
  repo?: string[];
  branch?: string[];
  userId?: string;
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
      summary: null,
      userId: run.userId ?? null,
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
    userId: row.userId ?? null,
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
  if (filters?.userId) {
    conditions.push(eq(runs.userId, filters.userId));
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

  if (filters.userId) {
    conditions.push(eq(runs.userId, filters.userId));
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

export function getDistinctRepos(db: AgentOpsDb, userId?: string): string[] {
  let query = db.selectDistinct({ repo: runs.repo }).from(runs).$dynamic();
  if (userId) query = query.where(eq(runs.userId, userId));
  const rows = query.orderBy(asc(runs.repo)).all();
  return rows.map((r) => r.repo);
}

export function getDistinctBranches(db: AgentOpsDb, userId?: string): string[] {
  let query = db.selectDistinct({ branch: runs.branch }).from(runs).$dynamic();
  if (userId) query = query.where(eq(runs.userId, userId));
  const rows = query.orderBy(asc(runs.branch)).all();
  return rows.map((r) => r.branch);
}

// ─── Summary persistence ──────────────────────────────────────────────────

export function updateRunSummary(
  db: AgentOpsDb,
  id: RunId,
  summary: SessionSummary,
): void {
  db.update(runs)
    .set({ summary: summary as unknown as Record<string, unknown> })
    .where(eq(runs.id, id as string))
    .run();
}

export function getRunSummary(
  db: AgentOpsDb,
  id: RunId,
): SessionSummary | null {
  const row = db
    .select({ summary: runs.summary })
    .from(runs)
    .where(eq(runs.id, id as string))
    .get();
  if (!row || !row.summary) return null;
  return row.summary as unknown as SessionSummary;
}

export interface RunWithSummary {
  readonly run: Run;
  readonly summary: SessionSummary | null;
}

export function listRunsWithSummaries(
  db: AgentOpsDb,
  filters?: ListRunsFilters,
): RunWithSummary[] {
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
  if (filters?.userId) {
    conditions.push(eq(runs.userId, filters.userId));
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
  return rows.map((row) => ({
    run: rowToRun(row),
    summary: row.summary ? (row.summary as unknown as SessionSummary) : null,
  }));
}

// ─── Data retention (Phase C3) ──────────────────────────────────────────────

export interface DeleteOldRunsResult {
  readonly runs: number;
  readonly policyResults: number;
  readonly runMetrics: number;
  readonly events: number;
  /** Run IDs that were deleted (useful for audit + dry-run preview). */
  readonly runIds: ReadonlyArray<string>;
}

/**
 * Delete runs created before the given ISO timestamp, plus every row in
 * tables that hangs off the run (policy_results, run_metrics, events
 * keyed by sourceId). The FK references aren't ON DELETE CASCADE so we
 * delete children before the parent.
 *
 * Sessions are NOT touched — they reference different lifecycle data
 * and a customer's retention policy might keep sessions for compliance
 * even when individual runs are pruned. If they want sessions gone too,
 * add a separate call.
 */
export function deleteOldRuns(
  db: AgentOpsDb,
  olderThanISO: string,
): DeleteOldRunsResult {
  // 1. Snapshot the IDs first so child deletes can target them precisely.
  const stale = db
    .select({ id: runs.id })
    .from(runs)
    .where(lt(runs.createdAt, olderThanISO))
    .all() as Array<{ id: string }>;
  const ids = stale.map((r) => r.id);
  if (ids.length === 0) {
    return { runs: 0, policyResults: 0, runMetrics: 0, events: 0, runIds: [] };
  }

  // 2. Delete dependent rows. Drizzle's .run() returns a result with a
  //    `changes` count via better-sqlite3.
  const prResult = db
    .delete(policyResults)
    .where(inArray(policyResults.runId, ids))
    .run() as { changes?: number };
  const rmResult = db
    .delete(runMetrics)
    .where(inArray(runMetrics.runId, ids))
    .run() as { changes?: number };
  // Events aren't FK-bound but their sourceId references the run; drop
  // them too so the events feed doesn't carry orphaned references.
  const evResult = db
    .delete(events)
    .where(inArray(events.sourceId, ids))
    .run() as { changes?: number };

  // 3. Now the runs themselves.
  const runResult = db
    .delete(runs)
    .where(inArray(runs.id, ids))
    .run() as { changes?: number };

  return {
    runs: runResult.changes ?? ids.length,
    policyResults: prResult.changes ?? 0,
    runMetrics: rmResult.changes ?? 0,
    events: evResult.changes ?? 0,
    runIds: ids,
  };
}

/** Count runs older than the cutoff (used for dry-run preview). */
export function countRunsOlderThan(db: AgentOpsDb, olderThanISO: string): number {
  const row = db
    .select({ total: count() })
    .from(runs)
    .where(lt(runs.createdAt, olderThanISO))
    .get();
  return Number(row?.total ?? 0);
}

/** Run SQLite VACUUM to reclaim space after a large delete. */
export function vacuum(db: AgentOpsDb): void {
  // Drizzle doesn't ship a typed VACUUM; raw sql works.
  db.run(sql`VACUUM`);
}

// ─── Attribution backfills ──────────────────────────────────────────────────
//
// One-shot operations for fixing rows recorded before some attribution
// signal existed. Repo backfill exists because `getCurrentRepo` falls
// through three tiers (origin → basename → "unknown") and the same
// project ends up under multiple names as its git state changes. User
// backfill exists because local-mode hooks have no auth concept, so
// pre-auth and local-only runs land with NULL user_id.

/** Count runs with no user_id (pre-auth or local-mode-only). */
export function countRunsWithoutUser(db: AgentOpsDb): number {
  const row = db
    .select({ total: count() })
    .from(runs)
    .where(sql`${runs.userId} IS NULL`)
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Assign userId to every run where user_id IS NULL. Returns the number
 * of rows changed. The caller is responsible for verifying the userId
 * actually exists in the users table — this function does not validate.
 */
export function reassignRunsWithoutUser(db: AgentOpsDb, userId: string): number {
  const result = db
    .update(runs)
    .set({ userId })
    .where(sql`${runs.userId} IS NULL`)
    .run() as { changes?: number };
  return result.changes ?? 0;
}

/** Count runs whose repo column matches the given string exactly. */
export function countRunsByRepo(db: AgentOpsDb, repo: string): number {
  const row = db
    .select({ total: count() })
    .from(runs)
    .where(eq(runs.repo, repo))
    .get();
  return Number(row?.total ?? 0);
}

/**
 * Remap repo on every matching run. The repo string is denormalized into
 * both the `repo` column AND the JSON `environment` field, so the update
 * touches both. The JSON edit uses SQLite's json_set so we don't need to
 * round-trip the whole environment object through application code.
 */
export function remapRunRepo(db: AgentOpsDb, from: string, to: string): number {
  const result = db
    .update(runs)
    .set({
      repo: to,
      environment: sql`json_set(${runs.environment}, '$.repo', ${to})` as unknown as Record<string, unknown>,
    })
    .where(eq(runs.repo, from))
    .run() as { changes?: number };
  return result.changes ?? 0;
}
