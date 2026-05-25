import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import {
  getBudget,
  listBudgets,
  upsertBudget,
  deleteBudget,
  markThresholdFired,
} from "../budgets.js";

describe("budgets", () => {
  let db: AgentOpsDb;
  const userId = "u_test";

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("getBudget returns null when no budget is set", () => {
    expect(getBudget(db, userId)).toBeNull();
  });

  it("upsertBudget inserts and round-trips dollars correctly", () => {
    const b = upsertBudget(db, {
      userId,
      amountUsd: 25.5,
      period: "month",
    });
    expect(b.amountUsd).toBe(25.5);
    expect(b.period).toBe("month");
    expect(b.warnAtPct).toBe(80); // default
    expect(b.lastWarnAt).toBeNull();
    expect(b.lastBreachAt).toBeNull();
  });

  it("upsertBudget updates an existing row and resets dedupe markers", () => {
    upsertBudget(db, { userId, amountUsd: 100, period: "month" });
    markThresholdFired(db, userId, "warning");
    const beforeUpdate = getBudget(db, userId);
    expect(beforeUpdate?.lastWarnAt).toBeTruthy();

    upsertBudget(db, { userId, amountUsd: 50, period: "week" });
    const after = getBudget(db, userId);
    expect(after?.amountUsd).toBe(50);
    expect(after?.period).toBe("week");
    expect(after?.lastWarnAt).toBeNull();
    expect(after?.lastBreachAt).toBeNull();
  });

  it("warnAtPct respects an explicit value", () => {
    const b = upsertBudget(db, {
      userId,
      amountUsd: 100,
      period: "month",
      warnAtPct: 50,
    });
    expect(b.warnAtPct).toBe(50);
  });

  it("listBudgets returns every set budget", () => {
    upsertBudget(db, { userId: "u_a", amountUsd: 10, period: "week" });
    upsertBudget(db, { userId: "u_b", amountUsd: 20, period: "month" });
    const all = listBudgets(db);
    expect(all).toHaveLength(2);
    expect(all.map((b) => b.userId).sort()).toEqual(["u_a", "u_b"]);
  });

  it("deleteBudget removes the row and returns true on hit, false on miss", () => {
    upsertBudget(db, { userId, amountUsd: 10, period: "week" });
    expect(deleteBudget(db, userId)).toBe(true);
    expect(getBudget(db, userId)).toBeNull();
    expect(deleteBudget(db, userId)).toBe(false);
  });

  it("markThresholdFired writes only the relevant column", () => {
    upsertBudget(db, { userId, amountUsd: 10, period: "month" });
    markThresholdFired(db, userId, "warning", "2026-05-20T00:00:00Z");
    let b = getBudget(db, userId);
    expect(b?.lastWarnAt).toBe("2026-05-20T00:00:00Z");
    expect(b?.lastBreachAt).toBeNull();

    markThresholdFired(db, userId, "breached", "2026-05-21T00:00:00Z");
    b = getBudget(db, userId);
    expect(b?.lastWarnAt).toBe("2026-05-20T00:00:00Z");
    expect(b?.lastBreachAt).toBe("2026-05-21T00:00:00Z");
  });

  it("amount is stored as cents internally — sub-cent doesn't round-trip exactly", () => {
    // Just documenting the expected behavior: dollars in, dollars out,
    // but anything finer than a cent gets rounded on insert.
    const b = upsertBudget(db, {
      userId,
      amountUsd: 9.999,
      period: "month",
    });
    expect(b.amountUsd).toBe(10.0);
  });
});
