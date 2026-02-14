import { NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = listRuns(db(), { limit: 1000 });

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
