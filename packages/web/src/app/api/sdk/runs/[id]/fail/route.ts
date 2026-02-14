import { NextRequest, NextResponse } from "next/server";
import { failRun, createRunId, createEvent, EventCategory, EVENT_TYPES } from "@agentops/core";
import { getRun, updateRun, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = getRun(db(), createRunId(id));
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const error = body.error as string;
    if (!error || typeof error !== "string") {
      return NextResponse.json(
        { error: "error field is required and must be a string" },
        { status: 400 },
      );
    }

    const failed = failRun(run, error);
    updateRun(db(), failed.id, {
      status: failed.status,
      decisions: failed.decisions,
      updatedAt: failed.updatedAt,
    });

    const event = createEvent(
      EventCategory.Run,
      EVENT_TYPES["run.failed"],
      failed.id as string,
      { runId: failed.id, error, details: body.details },
    );
    insertEvent(db(), event);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
