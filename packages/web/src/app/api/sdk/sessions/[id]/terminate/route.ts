import { NextRequest, NextResponse } from "next/server";
import {
  completeSessionRun,
  terminateSession,
  createEvent,
  EventCategory,
  EVENT_TYPES,
} from "@agentops/core";
import { updateSession, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ownership = await requireOwnedSession(request, id);
  if (ownership instanceof NextResponse) return ownership;
  const { session } = ownership;

  try {
    let next = completeSessionRun(session);
    next = terminateSession(next);

    updateSession(db(), next.id, {
      status: next.status,
      currentRunId: next.currentRunId,
      completedRunIds: next.completedRunIds,
      terminatedAt: next.terminatedAt,
      updatedAt: next.updatedAt,
    });

    insertEvent(
      db(),
      createEvent(
        EventCategory.Session,
        EVENT_TYPES["session.terminated"],
        next.id as string,
        { completedRuns: next.completedRunIds.length },
      ),
    );

    return NextResponse.json({ status: next.status });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
