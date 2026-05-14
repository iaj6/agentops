import { NextRequest, NextResponse } from "next/server";
import { getRun, getRunSummary } from "@agentops/db";
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
    const run = getRun(d, runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    // Members can only see their own runs. Admins see everything.
    // Pre-auth runs (userId == null) are admin-only.
    if (user.role !== "admin" && run.userId !== user.id) {
      // 404 instead of 403 — don't leak which run IDs exist.
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    const summary = getRunSummary(d, runId);
    return NextResponse.json({ run, summary });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
