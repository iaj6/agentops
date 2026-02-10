import { eq, and, desc, asc, inArray, sql, count } from "drizzle-orm";
import type { Job, JobId } from "@agentops/core";
import { createJobId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { jobs } from "./schema.js";

interface ListJobsFilters {
  status?: string;
  repo?: string;
  limit?: number;
  offset?: number;
}

function rowToJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: createJobId(row.id),
    status: row.status as Job["status"],
    priority: row.priority as Job["priority"],
    goal: row.goal as unknown as Job["goal"],
    environment: row.environment as unknown as Job["environment"],
    retryPolicy: row.retryPolicy as unknown as Job["retryPolicy"],
    concurrencyLimits: row.concurrencyLimits as unknown as Job["concurrencyLimits"],
    runIds: row.runIds as unknown as Job["runIds"],
    sessionId: (row.sessionId as Job["sessionId"]) ?? null,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    queuedAt: row.queuedAt,
    dispatchedAt: row.dispatchedAt ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function insertJob(db: AgentOpsDb, job: Job): void {
  db.insert(jobs)
    .values({
      id: job.id as string,
      status: job.status,
      priority: job.priority,
      goal: job.goal as unknown as Record<string, unknown>,
      environment: job.environment as unknown as Record<string, unknown>,
      repo: job.environment.repo,
      branch: job.environment.branch,
      retryPolicy: job.retryPolicy as unknown as Record<string, unknown>,
      concurrencyLimits: job.concurrencyLimits as unknown as Record<string, unknown>,
      runIds: job.runIds as unknown as Record<string, unknown>,
      sessionId: job.sessionId as string | null,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      queuedAt: job.queuedAt,
      dispatchedAt: job.dispatchedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })
    .run();
}

export function getJob(db: AgentOpsDb, id: JobId): Job | null {
  const row = db.select().from(jobs).where(eq(jobs.id, id as string)).get();
  if (!row) return null;
  return rowToJob(row);
}

export function listJobs(db: AgentOpsDb, filters?: ListJobsFilters): Job[] {
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(jobs.status, filters.status));
  }
  if (filters?.repo) {
    conditions.push(eq(jobs.repo, filters.repo));
  }

  let query = db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
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
  return rows.map(rowToJob);
}

export function updateJob(
  db: AgentOpsDb,
  id: JobId,
  updates: Partial<Job>,
): void {
  const values: Record<string, unknown> = {};

  if (updates.status !== undefined) values["status"] = updates.status;
  if (updates.priority !== undefined) values["priority"] = updates.priority;
  if (updates.sessionId !== undefined) values["sessionId"] = updates.sessionId;
  if (updates.runIds !== undefined) values["runIds"] = updates.runIds;
  if (updates.attempt !== undefined) values["attempt"] = updates.attempt;
  if (updates.dispatchedAt !== undefined) values["dispatchedAt"] = updates.dispatchedAt;
  if (updates.completedAt !== undefined) values["completedAt"] = updates.completedAt;
  if (updates.updatedAt !== undefined) values["updatedAt"] = updates.updatedAt;

  if (Object.keys(values).length > 0) {
    db.update(jobs).set(values).where(eq(jobs.id, id as string)).run();
  }
}

export function countJobsByRepo(
  db: AgentOpsDb,
  repo: string,
  statuses: string[],
): number {
  const conditions = [eq(jobs.repo, repo)];
  if (statuses.length > 0) {
    conditions.push(inArray(jobs.status, statuses));
  }

  const row = db
    .select({ total: count() })
    .from(jobs)
    .where(and(...conditions))
    .get();
  return row?.total ?? 0;
}

export function countJobsActive(db: AgentOpsDb): number {
  const row = db
    .select({ total: count() })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "dispatched", "running"]))
    .get();
  return row?.total ?? 0;
}

export function getQueuedJobs(db: AgentOpsDb, limit: number = 50): Job[] {
  const priorityOrder = sql`CASE ${jobs.priority}
    WHEN 'critical' THEN 4
    WHEN 'high' THEN 3
    WHEN 'normal' THEN 2
    WHEN 'low' THEN 1
    ELSE 0
  END`;

  const rows = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(desc(priorityOrder), asc(jobs.queuedAt))
    .limit(limit)
    .all();

  return rows.map(rowToJob);
}
