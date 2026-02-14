import { NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = listRuns(db(), { limit: 1000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyCounts = new Map<string, { completed: number; failed: number }>();

    // Seed all 30 days
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyCounts.set(key, { completed: 0, failed: 0 });
    }

    for (const run of runs) {
      const created = new Date(run.createdAt);
      if (created >= thirtyDaysAgo) {
        const key = created.toISOString().slice(0, 10);
        const entry = dailyCounts.get(key) ?? { completed: 0, failed: 0 };
        if (run.status === "completed") {
          entry.completed++;
        } else if (run.status === "failed") {
          entry.failed++;
        }
        dailyCounts.set(key, entry);
      }
    }

    const data = Array.from(dailyCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
