import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AgentOpsDb } from "./connection.js";
import { auditLog } from "./schema.js";

export interface AuditLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly userId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly ip: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface InsertAuditLogArgs {
  readonly userId?: string | null;
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly ip?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  /** Override the timestamp (for tests). Defaults to new Date().toISOString(). */
  readonly timestamp?: string;
}

/**
 * Insert an audit log row. Fire-and-forget from a caller's perspective —
 * the function returns the inserted entry but most callers ignore it.
 * Never throws on schema/value mismatch; that would break the wrapped
 * sensitive operation (login, policy update, etc.). Catches internally,
 * logs to stderr, and continues.
 */
export function insertAuditLog(
  db: AgentOpsDb,
  args: InsertAuditLogArgs,
): AuditLogEntry | null {
  const entry: AuditLogEntry = {
    id: `audit_${randomUUID()}`,
    timestamp: args.timestamp ?? new Date().toISOString(),
    userId: args.userId ?? null,
    action: args.action,
    targetType: args.targetType ?? null,
    targetId: args.targetId ?? null,
    ip: args.ip ?? null,
    metadata: args.metadata ?? null,
  };
  try {
    db.insert(auditLog)
      .values({
        id: entry.id,
        timestamp: entry.timestamp,
        userId: entry.userId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ip: entry.ip,
        metadata: entry.metadata as Record<string, unknown> | null,
      })
      .run();
    return entry;
  } catch (err) {
    // Defensive: an audit failure must never break the user-visible
    // operation that triggered it. Drop the row, log to stderr so an
    // operator can investigate.
    process.stderr.write(
      `[audit] failed to insert audit row for action=${entry.action}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return null;
  }
}

export interface ListAuditLogsFilters {
  userId?: string;
  action?: string;
  /** Inclusive lower bound on timestamp (ISO string). */
  since?: string;
  /** Inclusive upper bound on timestamp (ISO string). */
  until?: string;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: unknown;
}

function rowToEntry(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    userId: row.userId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    ip: row.ip,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function buildConditions(filters: ListAuditLogsFilters) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.since) conditions.push(gte(auditLog.timestamp, filters.since));
  if (filters.until) conditions.push(lte(auditLog.timestamp, filters.until));
  return conditions;
}

export function listAuditLogs(
  db: AgentOpsDb,
  filters: ListAuditLogsFilters = {},
): AuditLogEntry[] {
  const conditions = buildConditions(filters);
  let query = db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  if (filters.limit) query = query.limit(filters.limit);
  if (filters.offset) query = query.offset(filters.offset);
  const rows = query.all() as AuditRow[];
  return rows.map(rowToEntry);
}

export function countAuditLogs(
  db: AgentOpsDb,
  filters: ListAuditLogsFilters = {},
): number {
  const conditions = buildConditions(filters);
  let query = db
    .select({ total: sql<number>`count(*)` })
    .from(auditLog)
    .$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  const row = query.get();
  return Number(row?.total ?? 0);
}
