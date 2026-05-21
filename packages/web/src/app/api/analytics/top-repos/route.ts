import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    const runs = listRuns(db(), {
      limit: 1000,
      ...(scope.userId ? { userId: scope.userId } : {}),
    });

    const repoCounts = new Map<string, { count: number; totalCost: number }>();

    for (const run of runs) {
      const repo = run.environment.repo;
      const entry = repoCounts.get(repo) ?? { count: 0, totalCost: 0 };
      entry.count++;
      entry.totalCost += run.metrics.costUsd;
      repoCounts.set(repo, entry);
    }

    const data = Array.from(repoCounts.entries())
      .map(([repo, stats]) => ({
        repo,
        count: stats.count,
        totalCost: Math.round(stats.totalCost * 100) / 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
