import { eq, and, desc, sql } from "drizzle-orm";
import type { ResourceLock, LockId } from "@agentops/core";
import { createLockId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { locks } from "./schema.js";

interface ListLocksFilters {
  resource?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}

export function insertLock(db: AgentOpsDb, lock: ResourceLock): void {
  db.insert(locks)
    .values({
      id: lock.id as string,
      lockType: lock.lockType,
      resource: lock.resource,
      holderId: lock.holderId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      released: lock.released,
    })
    .run();
}

function rowToLock(row: typeof locks.$inferSelect): ResourceLock {
  return {
    id: createLockId(row.id),
    lockType: row.lockType as ResourceLock["lockType"],
    resource: row.resource,
    holderId: row.holderId,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    released: row.released,
  };
}

export function getLock(db: AgentOpsDb, id: LockId): ResourceLock | null {
  const row = db.select().from(locks).where(eq(locks.id, id as string)).get();
  if (!row) return null;
  return rowToLock(row);
}

export function listLocks(db: AgentOpsDb, filters?: ListLocksFilters): ResourceLock[] {
  const conditions = [];

  if (filters?.resource) {
    conditions.push(eq(locks.resource, filters.resource));
  }

  if (filters?.active) {
    conditions.push(eq(locks.released, false));
    conditions.push(sql`${locks.expiresAt} > datetime('now')`);
  }

  let query = db
    .select()
    .from(locks)
    .orderBy(desc(locks.acquiredAt))
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
  return rows.map(rowToLock);
}

export function updateLock(
  db: AgentOpsDb,
  id: LockId,
  updates: Partial<ResourceLock>,
): void {
  const values: Record<string, unknown> = {};

  if (updates.released !== undefined) values["released"] = updates.released;
  if (updates.expiresAt !== undefined) values["expiresAt"] = updates.expiresAt;

  if (Object.keys(values).length > 0) {
    db.update(locks).set(values).where(eq(locks.id, id as string)).run();
  }
}

export function getActiveLocks(db: AgentOpsDb, resource: string): ResourceLock[] {
  const rows = db
    .select()
    .from(locks)
    .where(
      and(
        eq(locks.resource, resource),
        eq(locks.released, false),
        sql`${locks.expiresAt} > datetime('now')`,
      ),
    )
    .orderBy(desc(locks.acquiredAt))
    .all();
  return rows.map(rowToLock);
}

export function getActiveLocksForHolder(db: AgentOpsDb, holderId: string): ResourceLock[] {
  const rows = db
    .select()
    .from(locks)
    .where(
      and(
        eq(locks.holderId, holderId),
        eq(locks.released, false),
        sql`${locks.expiresAt} > datetime('now')`,
      ),
    )
    .orderBy(desc(locks.acquiredAt))
    .all();
  return rows.map(rowToLock);
}

export function releaseLocksForHolder(db: AgentOpsDb, holderId: string): number {
  const result = db
    .update(locks)
    .set({ released: true })
    .where(
      and(
        eq(locks.holderId, holderId),
        eq(locks.released, false),
      ),
    )
    .run();
  return result.changes;
}

export function releaseExpiredLocks(db: AgentOpsDb): number {
  const result = db
    .update(locks)
    .set({ released: true })
    .where(
      and(
        eq(locks.released, false),
        sql`${locks.expiresAt} <= datetime('now')`,
      ),
    )
    .run();
  return result.changes;
}
