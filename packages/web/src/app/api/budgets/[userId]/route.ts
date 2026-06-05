import { NextRequest, NextResponse } from "next/server";
import {
  upsertBudget,
  deleteBudget,
  getBudget,
  getUserById,
  listRuns,
} from "@agentops/db";
import { computeBudgetState } from "@agentops/core";
import { db } from "@/lib/db";
import { requireAdmin, checkSameOrigin } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["week", "month"]);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const csrf = checkSameOrigin(request);
  if (csrf) return csrf;
  const me = await requireAdmin(request);
  if (me instanceof NextResponse) return me;

  try {
    const { userId } = await params;
    const d = db();

    if (!getUserById(d, userId)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { amountUsd?: unknown; period?: unknown; warnAtPct?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const amountUsd = typeof body.amountUsd === "number" ? body.amountUsd : NaN;
    const period = typeof body.period === "string" ? body.period : "";
    const warnAtPct =
      typeof body.warnAtPct === "number" ? body.warnAtPct : 80;

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return NextResponse.json(
        { error: "amountUsd must be a positive number" },
        { status: 400 },
      );
    }
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "period must be 'week' or 'month'" },
        { status: 400 },
      );
    }
    if (
      !Number.isFinite(warnAtPct) ||
      warnAtPct < 0 ||
      warnAtPct > 100
    ) {
      return NextResponse.json(
        { error: "warnAtPct must be between 0 and 100" },
        { status: 400 },
      );
    }

    const budget = upsertBudget(d, {
      userId,
      amountUsd,
      period: period as "week" | "month",
      warnAtPct,
    });
    const runs = listRuns(d, { userId, limit: 1000 });
    const state = computeBudgetState(budget, runs);

    recordAudit(request, me.id, AUDIT_ACTIONS.BUDGET_SET, {
      targetType: "budget",
      targetId: userId,
      metadata: { amountUsd, period, warnAtPct },
    });

    return NextResponse.json({ budget, state });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const csrf = checkSameOrigin(request);
  if (csrf) return csrf;
  const me = await requireAdmin(request);
  if (me instanceof NextResponse) return me;

  try {
    const { userId } = await params;
    const d = db();
    const existing = getBudget(d, userId);
    if (!existing) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }
    deleteBudget(d, userId);
    recordAudit(request, me.id, AUDIT_ACTIONS.BUDGET_DELETED, {
      targetType: "budget",
      targetId: userId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
