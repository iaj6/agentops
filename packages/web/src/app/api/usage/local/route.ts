import { NextResponse } from "next/server";
import { listRuns } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Local usage rollup for the /usage page. The Anthropic Admin API
// integration (when ANTHROPIC_ADMIN_API_KEY is set) shows org-wide
// totals across all Anthropic usage. This route surfaces what
// AgentOps has captured locally from Claude Code hook transcripts,
// so the page is useful even without the Admin API.

export async function GET() {
  try {
    const runs = listRuns(db(), { limit: 5000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let totalCost = 0;
    let totalCost30d = 0;
    let totalCost7d = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let runsWithCost = 0;

    for (const run of runs) {
      const cost = run.metrics.costUsd ?? 0;
      const t = run.metrics.tokenUsage;
      totalCost += cost;
      if (cost > 0) runsWithCost++;
      inputTokens += t?.input ?? 0;
      outputTokens += t?.output ?? 0;
      const created = new Date(run.createdAt);
      if (created >= thirtyDaysAgo) totalCost30d += cost;
      if (created >= sevenDaysAgo) totalCost7d += cost;
    }

    return NextResponse.json({
      totalCost,
      totalCost30d,
      totalCost7d,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalRuns: runs.length,
      runsWithCost,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
