// Core budget evaluation. No DB access here — callers pass the
// budget config and the user's runs and we compute the period spend
// + status. Keeping it pure makes the dedupe logic in the policy-check
// route easy to test against synthetic inputs.

export type BudgetPeriod = "week" | "month";

/**
 * The shape `computeBudgetState` actually needs from a run — just
 * enough to bucket it into a period and add its cost. Looser than
 * `Pick<Run, ...>` so callers can splice in a synthetic "current
 * session" row without filling in token usage, wall time, etc.
 */
export interface RunCostPoint {
  readonly createdAt: string;
  readonly metrics: { readonly costUsd: number };
}

export interface BudgetConfig {
  readonly amountUsd: number;
  readonly period: BudgetPeriod;
  readonly warnAtPct: number;
}

export type BudgetStatus = "ok" | "warning" | "breached";

export interface BudgetState {
  readonly spent: number;
  readonly pct: number;
  readonly status: BudgetStatus;
  /** ISO of the start of the current period (Monday UTC for week, day 1 UTC for month). */
  readonly periodStart: string;
}

/**
 * Start of the calendar period containing `now`. UTC; week starts
 * Monday. Predictable, locale-free boundaries — users can answer
 * "when does my clock reset?" without looking up timezones.
 */
export function budgetPeriodStart(period: BudgetPeriod, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "month") {
    return new Date(Date.UTC(y, m, 1));
  }
  // Week: roll back to Monday. UTC day-of-week is 0=Sun…6=Sat;
  // Monday offset is (day === 0 ? 6 : day - 1).
  const d = now.getUTCDate();
  const day = now.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(y, m, d - offset));
}

/**
 * Compute the user's budget state from the runs that landed inside
 * the current period. Caller is responsible for fetching the runs;
 * this is pure so it's trivially testable.
 *
 * `warnAtPct` of 0 or 100+ means "no warning band" — only the breach
 * status fires. Validated minimally; the API layer enforces sane
 * ranges on input.
 */
export function computeBudgetState(
  budget: BudgetConfig,
  runs: ReadonlyArray<RunCostPoint>,
  now: Date = new Date(),
): BudgetState {
  const start = budgetPeriodStart(budget.period, now);
  const startMs = start.getTime();
  const spent = runs.reduce((acc, r) => {
    const t = new Date(r.createdAt).getTime();
    if (t < startMs) return acc;
    // Defense in depth: the API layer rejects negative/non-finite costs, but
    // clamp here too so a bad legacy row can't deflate period spend and
    // suppress a budget breach. Treat negatives / NaN / Infinity as 0.
    const c = r.metrics?.costUsd ?? 0;
    return acc + (Number.isFinite(c) && c > 0 ? c : 0);
  }, 0);
  const pct =
    budget.amountUsd > 0 ? Math.round((spent / budget.amountUsd) * 100) : 0;
  let status: BudgetStatus = "ok";
  if (spent >= budget.amountUsd && budget.amountUsd > 0) {
    status = "breached";
  } else if (budget.warnAtPct > 0 && pct >= budget.warnAtPct) {
    status = "warning";
  }
  return { spent, pct, status, periodStart: start.toISOString() };
}

/**
 * Decide which threshold-crossing event (if any) to emit, given the
 * computed state and the last-fired timestamps. Returns null when no
 * event should fire — either because the threshold isn't crossed,
 * or because we already fired one for this period.
 *
 * Order matters: `breached` always wins over `warning` if both are
 * eligible the same call, because crossing the budget itself is the
 * more important signal.
 */
export function pickBudgetEvent(
  state: BudgetState,
  lastWarnAt: string | null,
  lastBreachAt: string | null,
): "warning" | "breached" | null {
  const periodStartMs = new Date(state.periodStart).getTime();
  const inPeriod = (iso: string | null): boolean =>
    iso !== null && new Date(iso).getTime() >= periodStartMs;

  if (state.status === "breached" && !inPeriod(lastBreachAt)) {
    return "breached";
  }
  if (state.status === "warning" && !inPeriod(lastWarnAt)) {
    return "warning";
  }
  return null;
}
