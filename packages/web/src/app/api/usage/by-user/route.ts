import { NextResponse, type NextRequest } from "next/server";
import { listRuns, listUsers } from "@agentops/db";
import {
  BEDROCK_PRICING_IS_PARITY_ESTIMATE,
  BEDROCK_PRICING_VERIFIED_DATE,
} from "@agentops/core";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Team-wide per-user spend, split by backend — the "who is burning the
// Bedrock spend" view that AWS Cost Explorer structurally can't give you
// (it attributes by IAM principal, with no agent/session/user concept).
// Admin-only: members are always scoped to themselves (resolveViewScope),
// so a team-wide breakdown is an admin artifact by design — mirrors
// /api/budgets.

// Runs with no userId (pre-auth / ambiguous local attribution) are collected
// under this sentinel and rendered as a single "Unattributed" row — never
// hidden, never folded into a real user.
const UNATTRIBUTED = "__unattributed__";

interface Cell {
  bedrock: number;
  anthropic: number;
  unknown: number;
  runs: number;
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;

  try {
    const d = db();
    const runs = listRuns(d, { limit: 5000 });
    const userMap = new Map(listUsers(d).map((u) => [u.id, u]));

    const acc = new Map<string, Cell>();
    for (const run of runs) {
      const key = run.userId ?? UNATTRIBUTED;
      const cell = acc.get(key) ?? { bedrock: 0, anthropic: 0, unknown: 0, runs: 0 };
      const cost = run.metrics.costUsd ?? 0;
      const backend = run.metrics.backend;
      if (backend === "bedrock") cell.bedrock += cost;
      else if (backend === "anthropic") cell.anthropic += cost;
      else cell.unknown += cost;
      cell.runs += 1;
      acc.set(key, cell);
    }

    const rows = [...acc.entries()].map(([key, c]) => {
      const unattributed = key === UNATTRIBUTED;
      const u = unattributed ? undefined : userMap.get(key);
      return {
        userId: unattributed ? null : key,
        userEmail: u?.email ?? null,
        userName: u?.name ?? null,
        unattributed,
        bedrock: c.bedrock,
        anthropic: c.anthropic,
        unknown: c.unknown,
        total: c.bedrock + c.anthropic + c.unknown,
        runs: c.runs,
      };
    });

    // Rank by Bedrock spend desc, then total desc. The Unattributed row
    // always sinks to the bottom so it never tops the "who's burning it" view.
    rows.sort((a, b) => {
      if (a.unattributed !== b.unattributed) return a.unattributed ? 1 : -1;
      if (b.bedrock !== a.bedrock) return b.bedrock - a.bedrock;
      return b.total - a.total;
    });

    return NextResponse.json({
      rows,
      // Bedrock $ are computed at Anthropic-parity rates today — let the UI
      // flag them as estimated, same as /api/usage/local.
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
