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

    const dailyFiles = new Map<string, number>();

    // Seed all 30 days
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyFiles.set(key, 0);
    }

    for (const run of runs) {
      const created = new Date(run.createdAt);
      if (created >= thirtyDaysAgo) {
        const key = created.toISOString().slice(0, 10);
        let fileEditCount = 0;
        for (const action of run.actions) {
          fileEditCount += action.fileEdits.length;
        }
        dailyFiles.set(key, (dailyFiles.get(key) ?? 0) + fileEditCount);
      }
    }

    const data = Array.from(dailyFiles.entries())
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
