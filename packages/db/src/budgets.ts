import { eq } from "drizzle-orm";
import type { AgentOpsDb } from "./connection.js";
import { userBudgets } from "./schema.js";

// Per-user period budgets. Stored as cents (integer) and surfaced to
// the rest of the app as dollars (number) — the conversion lives in
// this module so callers never see cents.

export type BudgetPeriod = "week" | "month";

export interface UserBudget {
  readonly userId: string;
  readonly amountUsd: number;
  readonly period: BudgetPeriod;
  readonly warnAtPct: number;
  readonly lastWarnAt: string | null;
  readonly lastBreachAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function rowToBudget(row: typeof userBudgets.$inferSelect): UserBudget {
  return {
    userId: row.userId,
    amountUsd: row.amountUsd / 100,
    period: row.period as BudgetPeriod,
    warnAtPct: row.warnAtPct,
    lastWarnAt: row.lastWarnAt ?? null,
    lastBreachAt: row.lastBreachAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getBudget(db: AgentOpsDb, userId: string): UserBudget | null {
  const row = db
    .select()
    .from(userBudgets)
    .where(eq(userBudgets.userId, userId))
    .get();
  return row ? rowToBudget(row) : null;
}

export function listBudgets(db: AgentOpsDb): UserBudget[] {
  const rows = db.select().from(userBudgets).all();
  return rows.map(rowToBudget);
}

/**
 * Upsert a budget. Resets the dedupe markers (lastWarnAt /
 * lastBreachAt) because changing the threshold should give the user
 * a fresh chance to be warned — otherwise lowering the cap mid-period
 * would silently suppress a notification that should now fire.
 */
export function upsertBudget(
  db: AgentOpsDb,
  args: {
    userId: string;
    amountUsd: number;
    period: BudgetPeriod;
    warnAtPct?: number;
  },
): UserBudget {
  const now = new Date().toISOString();
  const cents = Math.round(args.amountUsd * 100);
  const warnAtPct = args.warnAtPct ?? 80;
  const existing = getBudget(db, args.userId);

  if (existing) {
    db.update(userBudgets)
      .set({
        amountUsd: cents,
        period: args.period,
        warnAtPct,
        lastWarnAt: null,
        lastBreachAt: null,
        updatedAt: now,
      })
      .where(eq(userBudgets.userId, args.userId))
      .run();
  } else {
    db.insert(userBudgets)
      .values({
        userId: args.userId,
        amountUsd: cents,
        period: args.period,
        warnAtPct,
        lastWarnAt: null,
        lastBreachAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return getBudget(db, args.userId)!;
}

export function deleteBudget(db: AgentOpsDb, userId: string): boolean {
  const result = db
    .delete(userBudgets)
    .where(eq(userBudgets.userId, userId))
    .run() as { changes?: number };
  return (result.changes ?? 0) > 0;
}

/**
 * Mark that we've emitted a threshold event for this user during the
 * current period. Used by the policy-check route's dedupe path.
 */
export function markThresholdFired(
  db: AgentOpsDb,
  userId: string,
  kind: "warning" | "breached",
  at: string = new Date().toISOString(),
): void {
  const updates =
    kind === "warning" ? { lastWarnAt: at } : { lastBreachAt: at };
  db.update(userBudgets)
    .set({ ...updates, updatedAt: at })
    .where(eq(userBudgets.userId, userId))
    .run();
}
