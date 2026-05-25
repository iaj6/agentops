import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { policyResults, runs } from "@agentops/db";
import { and, eq } from "drizzle-orm";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const d = db();
    const scope = resolveViewScope(user, request.nextUrl.searchParams);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyViolations = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const dd = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dd.toISOString().slice(0, 10);
      dailyViolations.set(key, 0);
    }

    // Join to runs so we can filter on the run's owner. Without the
    // join the chart would show team-wide violations even when the
    // user-filter chip narrowed every other Analytics panel.
    const baseQuery = d
      .select({ evaluatedAt: policyResults.evaluatedAt })
      .from(policyResults)
      .innerJoin(runs, eq(policyResults.runId, runs.id));

    const conditions = [eq(policyResults.passed, false)];
    if (scope.userId) {
      conditions.push(eq(runs.userId, scope.userId));
    }

    const failedResults = baseQuery.where(and(...conditions)).all();

    for (const result of failedResults) {
      const evalDate = new Date(result.evaluatedAt);
      if (evalDate >= thirtyDaysAgo) {
        const key = evalDate.toISOString().slice(0, 10);
        dailyViolations.set(key, (dailyViolations.get(key) ?? 0) + 1);
      }
    }

    const data = Array.from(dailyViolations.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
