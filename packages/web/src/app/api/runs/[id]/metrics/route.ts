import { NextRequest, NextResponse } from "next/server";
import { getRunMetrics, getRun } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const d = db();
    const runId = createRunId(id);
    // Same ownership rules as GET /api/runs/[id]: members only see their
    // own runs; pre-auth runs (userId == null) are admin-only. 404 (not
    // 403) on non-owner so run IDs can't be enumerated.
    const run = getRun(d, runId);
    if (!run || (user.role !== "admin" && run.userId !== user.id)) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const metrics = getRunMetrics(d, runId);
    if (!metrics) {
      return NextResponse.json({ error: "Metrics not found" }, { status: 404 });
    }
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
