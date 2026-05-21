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

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyDurations = new Map<string, { totalMs: number; count: number }>();

    // Seed all 30 days
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyDurations.set(key, { totalMs: 0, count: 0 });
    }

    for (const run of runs) {
      const created = new Date(run.createdAt);
      if (created >= thirtyDaysAgo && run.metrics.wallTimeMs > 0) {
        const key = created.toISOString().slice(0, 10);
        const entry = dailyDurations.get(key) ?? { totalMs: 0, count: 0 };
        entry.totalMs += run.metrics.wallTimeMs;
        entry.count++;
        dailyDurations.set(key, entry);
      }
    }

    const data = Array.from(dailyDurations.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({
        date,
        avgMs: entry.count > 0 ? Math.round(entry.totalMs / entry.count) : 0,
      }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
