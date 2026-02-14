import { NextRequest, NextResponse } from "next/server";
import { getRun, getRunSummary } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const d = db();
    const runId = createRunId(id);
    const run = getRun(d, runId);
    if (!run) {
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
