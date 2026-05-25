import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  listUsers,
  listBudgets,
  listRuns,
  type UserBudget,
} from "@agentops/db";
import { computeBudgetState, type BudgetState } from "@agentops/core";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/auth";
import { BudgetsTable } from "./BudgetsTable";

export const metadata: Metadata = {
  title: "Budgets",
  description: "Per-user spend caps and threshold alerts",
};

export const dynamic = "force-dynamic";

export interface BudgetRowProps {
  userId: string;
  userName: string | null;
  userEmail: string;
  budget: UserBudget | null;
  state: BudgetState | null;
}

export default async function AdminBudgetsPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/admin/budgets");
  if (user.role !== "admin") redirect("/");

  const d = db();
  const users = listUsers(d);
  const budgets = new Map(listBudgets(d).map((b) => [b.userId, b]));

  // Build a row per user — set or unset. Computing state requires a
  // fetch per user; fine at trial scale (6 users), revisit if a real
  // customer has hundreds.
  const rows: BudgetRowProps[] = users.map((u) => {
    const budget = budgets.get(u.id) ?? null;
    let state: BudgetState | null = null;
    if (budget) {
      const runs = listRuns(d, { userId: u.id, limit: 1000 });
      state = computeBudgetState(budget, runs);
    }
    return {
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      budget,
      state,
    };
  });

  // Sort: budget-set first (so admin sees attention items at top),
  // then by spend descending.
  rows.sort((a, b) => {
    if (!!a.budget !== !!b.budget) return a.budget ? -1 : 1;
    return (b.state?.spent ?? 0) - (a.state?.spent ?? 0);
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Budgets</h1>
        <p className="text-sm text-muted">
          Per-user spend caps with warning + breach notifications.
          Alerts fire as <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">budget.warning</code> and{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">budget.breached</code> events,
          delivered via your configured webhooks.
        </p>
      </div>
      <BudgetsTable rows={JSON.parse(JSON.stringify(rows))} />
    </div>
  );
}
