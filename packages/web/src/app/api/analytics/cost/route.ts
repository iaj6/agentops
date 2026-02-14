import { NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get all runs from last 30 days
    const runs = listRuns(db(), { limit: 1000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build daily cost map
    const dailyCost = new Map<string, number>();

    // Seed all 30 days with 0
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyCost.set(key, 0);
    }

    for (const run of runs) {
      const created = new Date(run.createdAt);
      if (created >= thirtyDaysAgo) {
        const key = created.toISOString().slice(0, 10);
        dailyCost.set(key, (dailyCost.get(key) ?? 0) + run.metrics.costUsd);
      }
    }

    const data = Array.from(dailyCost.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost: Math.round(cost * 100) / 100 }));

    return NextResponse.json(data);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
