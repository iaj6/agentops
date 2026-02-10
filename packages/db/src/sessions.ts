import { eq, and, desc, lt, count } from "drizzle-orm";
import type { Session, SessionId } from "@agentops/core";
import { createSessionId, createAgentId, createRunId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { sessions } from "./schema.js";

interface ListSessionsFilters {
  status?: string;
  limit?: number;
  offset?: number;
}

export function insertSession(db: AgentOpsDb, session: Session): void {
  db.insert(sessions)
    .values({
      id: session.id as string,
      status: session.status,
      agentId: session.agentId as string,
      currentRunId: session.currentRunId as string | null,
      completedRunIds: session.completedRunIds as unknown as Record<string, unknown>,
      resourceUsage: session.resourceUsage as unknown as Record<string, unknown>,
      metadata: session.metadata as Record<string, unknown>,
      startedAt: session.startedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
      terminatedAt: session.terminatedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    .run();
}

function rowToSession(row: typeof sessions.$inferSelect): Session {
  const completedRunIds = row.completedRunIds as unknown as string[];
  return {
    id: createSessionId(row.id),
    status: row.status as Session["status"],
    agentId: createAgentId(row.agentId),
    currentRunId: row.currentRunId ? createRunId(row.currentRunId) : null,
    completedRunIds: completedRunIds.map(createRunId),
    resourceUsage: row.resourceUsage as unknown as Session["resourceUsage"],
    metadata: row.metadata as Record<string, unknown>,
    startedAt: row.startedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    terminatedAt: row.terminatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getSession(db: AgentOpsDb, id: SessionId): Session | null {
  const row = db.select().from(sessions).where(eq(sessions.id, id as string)).get();
  if (!row) return null;
  return rowToSession(row);
}

export function listSessions(db: AgentOpsDb, filters?: ListSessionsFilters): Session[] {
  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(sessions.status, filters.status));
  }

  let query = db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.createdAt))
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
  return rows.map(rowToSession);
}

export function updateSession(
  db: AgentOpsDb,
  id: SessionId,
  updates: Partial<Session>,
): void {
  const values: Record<string, unknown> = {};

  if (updates.status !== undefined) values["status"] = updates.status;
  if (updates.agentId !== undefined) values["agentId"] = updates.agentId;
  if (updates.currentRunId !== undefined) values["currentRunId"] = updates.currentRunId;
  if (updates.completedRunIds !== undefined) values["completedRunIds"] = updates.completedRunIds;
  if (updates.resourceUsage !== undefined) values["resourceUsage"] = updates.resourceUsage;
  if (updates.metadata !== undefined) values["metadata"] = updates.metadata;
  if (updates.lastHeartbeatAt !== undefined) values["lastHeartbeatAt"] = updates.lastHeartbeatAt;
  if (updates.terminatedAt !== undefined) values["terminatedAt"] = updates.terminatedAt;
  if (updates.updatedAt !== undefined) values["updatedAt"] = updates.updatedAt;

  if (Object.keys(values).length > 0) {
    db.update(sessions).set(values).where(eq(sessions.id, id as string)).run();
  }
}

export function getActiveSessions(db: AgentOpsDb): Session[] {
  const rows = db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"))
    .orderBy(desc(sessions.lastHeartbeatAt))
    .all();
  return rows.map(rowToSession);
}

export function countActiveSessions(db: AgentOpsDb): number {
  const row = db
    .select({ total: count() })
    .from(sessions)
    .where(eq(sessions.status, "active"))
    .get();
  return row?.total ?? 0;
}

export function getStaleSessions(db: AgentOpsDb, thresholdIso: string): Session[] {
  const rows = db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "active"),
        lt(sessions.lastHeartbeatAt, thresholdIso),
      ),
    )
    .all();
  return rows.map(rowToSession);
}
