import { eq, and, desc, gte, lte, count, inArray, sql } from "drizzle-orm";
import type { AgentEvent, EventId } from "@agentops/core";
import { createEventId } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { events } from "./schema.js";

interface ListEventsFilters {
  category?: string;
  type?: string;
  sourceId?: string;
  /**
   * Only include events whose sourceId is in this set. Used to scope a
   * view to one user's events by resolving their owned run + session
   * IDs first. Empty array matches nothing (intentional — "this user
   * has no records, so no events").
   */
  sourceIds?: ReadonlyArray<string>;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

function rowToEvent(row: typeof events.$inferSelect): AgentEvent {
  return {
    id: createEventId(row.id),
    category: row.category as AgentEvent["category"],
    type: row.type,
    payload: row.payload as Record<string, unknown>,
    sourceId: row.sourceId,
    timestamp: row.timestamp,
  };
}

export function insertEvent(db: AgentOpsDb, event: AgentEvent): void {
  db.insert(events)
    .values({
      id: event.id as string,
      category: event.category,
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      sourceId: event.sourceId,
      timestamp: event.timestamp,
    })
    .run();
}

export function getEvent(db: AgentOpsDb, id: EventId): AgentEvent | null {
  const row = db.select().from(events).where(eq(events.id, id as string)).get();
  if (!row) return null;
  return rowToEvent(row);
}

function buildConditions(filters: ListEventsFilters) {
  const conditions = [];

  if (filters.category) {
    conditions.push(eq(events.category, filters.category));
  }
  if (filters.type) {
    conditions.push(eq(events.type, filters.type));
  }
  if (filters.sourceId) {
    conditions.push(eq(events.sourceId, filters.sourceId));
  }
  if (filters.sourceIds) {
    // Empty array → match nothing (the user owns no records). Without
    // this branch an empty list would compile to `IN ()` which is a
    // syntax error.
    if (filters.sourceIds.length === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(inArray(events.sourceId, [...filters.sourceIds]));
    }
  }
  if (filters.since) {
    conditions.push(gte(events.timestamp, filters.since));
  }
  if (filters.until) {
    conditions.push(lte(events.timestamp, filters.until));
  }

  return conditions;
}

export function listEvents(db: AgentOpsDb, filters?: ListEventsFilters): AgentEvent[] {
  const conditions = filters ? buildConditions(filters) : [];

  let query = db
    .select()
    .from(events)
    .orderBy(desc(events.timestamp))
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
  return rows.map(rowToEvent);
}

export function countEvents(db: AgentOpsDb, filters?: ListEventsFilters): number {
  const conditions = filters ? buildConditions(filters) : [];

  let query = db
    .select({ total: count() })
    .from(events)
    .$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const row = query.get();
  return row?.total ?? 0;
}

export function getEventsBySource(db: AgentOpsDb, sourceId: string, limit = 50): AgentEvent[] {
  const rows = db
    .select()
    .from(events)
    .where(eq(events.sourceId, sourceId))
    .orderBy(desc(events.timestamp))
    .limit(limit)
    .all();
  return rows.map(rowToEvent);
}

export function getRecentEvents(db: AgentOpsDb, limit = 50): AgentEvent[] {
  const rows = db
    .select()
    .from(events)
    .orderBy(desc(events.timestamp))
    .limit(limit)
    .all();
  return rows.map(rowToEvent);
}
