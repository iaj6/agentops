import { NextResponse, type NextRequest } from "next/server";
import { listRuns } from "@agentops/db";
import {
  BEDROCK_PRICING_IS_PARITY_ESTIMATE,
  BEDROCK_PRICING_VERIFIED_DATE,
} from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Local usage rollup for the /usage page. The Anthropic Admin API
// integration (when ANTHROPIC_ADMIN_API_KEY is set) shows org-wide
// totals across all Anthropic usage. This route surfaces what
// AgentOps has captured locally from Claude Code hook transcripts,
// so the page is useful even without the Admin API.

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    // Members see only their own usage; admins see the team total unless
    // they opt into ?view=mine / ?userId=<id>.
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    const runs = listRuns(db(), {
      limit: 5000,
      ...(scope.userId ? { userId: scope.userId } : {}),
    });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let totalCost = 0;
    let totalCost30d = 0;
    let totalCost7d = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let runsWithCost = 0;

    // Segment spend by the backend that served it. Runs recorded before
    // backend capture landed (and any without the tag) fall into "unknown" —
    // surfaced as "Not yet classified", never folded into Direct, which would
    // manufacture a confident "you have no Bedrock spend".
    const costByBackend = { bedrock: 0, anthropic: 0, unknown: 0 };

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

      const backend = run.metrics.backend;
      if (backend === "bedrock") costByBackend.bedrock += cost;
      else if (backend === "anthropic") costByBackend.anthropic += cost;
      else costByBackend.unknown += cost;
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
      costByBackend,
      // Bedrock $ are computed at Anthropic-parity rates today; let the UI flag
      // them as estimated rather than presenting them as AWS-billing truth.
      bedrockIsEstimate: BEDROCK_PRICING_IS_PARITY_ESTIMATE,
      bedrockRatesVerifiedDate: BEDROCK_PRICING_VERIFIED_DATE,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
