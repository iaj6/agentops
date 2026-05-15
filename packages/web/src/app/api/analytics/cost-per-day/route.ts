import { NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Daily cost rollup for the Analytics page. Mirrors the files-changed
// and policy-violations routes: 30-day window, zero-filled, sorted
// ascending by date. The Cost Per Day chart on the dashboard binds
// directly to the response shape.

export async function GET() {
  try {
    const runs = listRuns(db(), { limit: 5000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyCost = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyCost.set(key, 0);
    }

    for (const run of runs) {
      const created = new Date(run.createdAt);
      if (created < thirtyDaysAgo) continue;
      const key = created.toISOString().slice(0, 10);
      const cost = run.metrics.costUsd ?? 0;
      dailyCost.set(key, (dailyCost.get(key) ?? 0) + cost);
    }

    const data = Array.from(dailyCost.entries())
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
