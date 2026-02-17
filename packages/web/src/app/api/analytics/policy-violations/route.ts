import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { policyResults } from "@agentops/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = db();

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyViolations = new Map<string, number>();

    // Seed all 30 days
    for (let i = 0; i < 30; i++) {
      const dd = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dd.toISOString().slice(0, 10);
      dailyViolations.set(key, 0);
    }

    // Query all failed policy results
    const failedResults = d
      .select()
      .from(policyResults)
      .where(eq(policyResults.passed, false))
      .all();

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
