import { NextResponse } from "next/server";
import { listJobs } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allJobs = listJobs(db(), { limit: 10000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build daily completion counts
    const dailyCounts = new Map<string, number>();

    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyCounts.set(key, 0);
    }

    for (const job of allJobs) {
      if (job.completedAt) {
        const completed = new Date(job.completedAt);
        if (completed >= thirtyDaysAgo) {
          const key = completed.toISOString().slice(0, 10);
          dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const throughput = Array.from(dailyCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, completed: count }));

    // Cost by priority
    const costByPriority: Record<string, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    for (const job of allJobs) {
      // Estimate cost from associated runs - we use job priority as a category
      const p = job.priority;
      if (p in costByPriority) {
        costByPriority[p] += 1; // Count jobs per priority (actual cost requires run join)
      }
    }

    return NextResponse.json({
      throughput,
      costByPriority: Object.entries(costByPriority).map(([priority, count]) => ({
        priority: priority.charAt(0).toUpperCase() + priority.slice(1),
        count,
      })),
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
