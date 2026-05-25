import { NextRequest, NextResponse } from "next/server";
import { listBudgets, listRuns, listUsers, type UserBudget } from "@agentops/db";
import { computeBudgetState } from "@agentops/core";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface BudgetRow {
  userId: string;
  userName: string | null;
  userEmail: string;
  budget: UserBudget;
  state: ReturnType<typeof computeBudgetState>;
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;

  try {
    const d = db();
    const budgets = listBudgets(d);
    const userMap = new Map(listUsers(d).map((u) => [u.id, u]));

    // Compute state for each. listRuns is the cheapest path — limit
    // is generous (1000) but pinned, so a user with thousands of
    // runs in a period would under-report. Acceptable for trial
    // scale; revisit if a customer exercises that.
    const rows: BudgetRow[] = budgets.map((budget) => {
      const runs = listRuns(d, { userId: budget.userId, limit: 1000 });
      const state = computeBudgetState(budget, runs);
      const u = userMap.get(budget.userId);
      return {
        userId: budget.userId,
        userName: u?.name ?? null,
        userEmail: u?.email ?? "(unknown)",
        budget,
        state,
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
