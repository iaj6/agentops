import { NextRequest, NextResponse } from "next/server";
import { getBudget, listRuns } from "@agentops/db";
import { computeBudgetState } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const d = db();
    const budget = getBudget(d, user.id);
    if (!budget) {
      return NextResponse.json({ budget: null, state: null });
    }
    const runs = listRuns(d, { userId: user.id, limit: 1000 });
    const state = computeBudgetState(budget, runs);
    return NextResponse.json({ budget, state });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
