import { describe, it, expect } from "vitest";
import {
  budgetPeriodStart,
  computeBudgetState,
  pickBudgetEvent,
} from "../budget.js";
import type { BudgetConfig, BudgetState } from "../budget.js";

// Synthetic run shape — just enough fields for computeBudgetState.
function run(createdAt: string, costUsd: number) {
  return {
    createdAt,
    metrics: {
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      wallTimeMs: 0,
      costUsd,
      flakeRate: 0,
    },
  };
}

describe("budgetPeriodStart", () => {
  it("week boundary rolls back to Monday UTC", () => {
    // Wed 2026-05-20 → Mon 2026-05-18
    const start = budgetPeriodStart("week", new Date("2026-05-20T15:30:00Z"));
    expect(start.toISOString()).toBe("2026-05-18T00:00:00.000Z");
  });

  it("week boundary on Sunday rolls back to previous Monday", () => {
    // Sun 2026-05-24 → Mon 2026-05-18 (6 days back, not 0)
    const start = budgetPeriodStart("week", new Date("2026-05-24T03:00:00Z"));
    expect(start.toISOString()).toBe("2026-05-18T00:00:00.000Z");
  });

  it("week boundary on Monday is the same day", () => {
    const start = budgetPeriodStart("week", new Date("2026-05-25T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-05-25T00:00:00.000Z");
  });

  it("month boundary is day 1 UTC", () => {
    const start = budgetPeriodStart("month", new Date("2026-05-25T15:30:00Z"));
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("computeBudgetState", () => {
  const budget: BudgetConfig = {
    amountUsd: 100,
    period: "month",
    warnAtPct: 80,
  };
  const now = new Date("2026-05-25T12:00:00Z"); // mid-May

  it("ok when far below warn threshold", () => {
    const state = computeBudgetState(
      budget,
      [run("2026-05-20T00:00:00Z", 25)],
      now,
    );
    expect(state.status).toBe("ok");
    expect(state.spent).toBe(25);
    expect(state.pct).toBe(25);
  });

  it("clamps negative/non-finite costs to 0 so they can't deflate spend or mask a breach", () => {
    // A negative-cost run alongside a real breach must not pull `spent` back
    // under budget and suppress the breached status.
    const state = computeBudgetState(
      budget,
      [
        run("2026-05-20T00:00:00Z", 100), // genuine breach
        run("2026-05-21T00:00:00Z", -90), // poison attempt → clamped to 0
        run("2026-05-22T00:00:00Z", Infinity), // non-finite → clamped to 0
      ],
      now,
    );
    expect(state.spent).toBe(100);
    expect(state.status).toBe("breached");
  });

  it("warning when at or above warn threshold but under budget", () => {
    const state = computeBudgetState(
      budget,
      [run("2026-05-22T00:00:00Z", 85)],
      now,
    );
    expect(state.status).toBe("warning");
    expect(state.pct).toBe(85);
  });

  it("breached when at or above budget", () => {
    const state = computeBudgetState(
      budget,
      [run("2026-05-22T00:00:00Z", 100)],
      now,
    );
    expect(state.status).toBe("breached");
    expect(state.pct).toBe(100);
  });

  it("excludes runs from before the period start", () => {
    const state = computeBudgetState(
      budget,
      [
        run("2026-04-30T23:00:00Z", 500), // previous month — ignored
        run("2026-05-02T00:00:00Z", 30),
      ],
      now,
    );
    expect(state.spent).toBe(30);
  });

  it("week period uses Monday boundary, not 7-day rolling", () => {
    const weekBudget: BudgetConfig = {
      amountUsd: 50,
      period: "week",
      warnAtPct: 80,
    };
    // Pick a `now` mid-week (Wed 2026-05-20) so the previous week's
    // Sunday is clearly out and Tuesday this week is clearly in.
    const wedNow = new Date("2026-05-20T12:00:00Z");
    const state = computeBudgetState(
      weekBudget,
      [
        run("2026-05-17T23:59:00Z", 99), // Sunday of previous week — ignored
        run("2026-05-19T00:00:00Z", 20), // Tuesday this week — included
      ],
      wedNow,
    );
    expect(state.spent).toBe(20);
    expect(state.periodStart).toBe("2026-05-18T00:00:00.000Z");
  });

  it("warnAtPct=0 disables warning band — only breach fires", () => {
    const state = computeBudgetState(
      { ...budget, warnAtPct: 0 },
      [run("2026-05-22T00:00:00Z", 90)],
      now,
    );
    expect(state.status).toBe("ok");
  });

  it("amount=0 produces 0% and never breaches", () => {
    const state = computeBudgetState(
      { ...budget, amountUsd: 0 },
      [run("2026-05-22T00:00:00Z", 5)],
      now,
    );
    expect(state.status).toBe("ok");
    expect(state.pct).toBe(0);
  });
});

describe("pickBudgetEvent", () => {
  const periodStart = "2026-05-18T00:00:00.000Z";
  const okState: BudgetState = {
    spent: 5,
    pct: 5,
    status: "ok",
    periodStart,
  };
  const warnState: BudgetState = { ...okState, status: "warning", pct: 85 };
  const breachState: BudgetState = { ...okState, status: "breached", pct: 100 };

  it("returns null when status is ok", () => {
    expect(pickBudgetEvent(okState, null, null)).toBeNull();
  });

  it("fires warning when never fired this period", () => {
    expect(pickBudgetEvent(warnState, null, null)).toBe("warning");
  });

  it("suppresses warning when already fired this period", () => {
    expect(pickBudgetEvent(warnState, "2026-05-20T00:00:00Z", null)).toBeNull();
  });

  it("fires warning again if last fire was before this period", () => {
    expect(pickBudgetEvent(warnState, "2026-04-30T00:00:00Z", null)).toBe(
      "warning",
    );
  });

  it("fires breach even if warning was already sent", () => {
    expect(
      pickBudgetEvent(breachState, "2026-05-20T00:00:00Z", null),
    ).toBe("breached");
  });

  it("suppresses breach when already fired this period", () => {
    expect(
      pickBudgetEvent(breachState, null, "2026-05-20T00:00:00Z"),
    ).toBeNull();
  });

  it("breach wins over warning when both would fire", () => {
    expect(pickBudgetEvent(breachState, null, null)).toBe("breached");
  });
});
