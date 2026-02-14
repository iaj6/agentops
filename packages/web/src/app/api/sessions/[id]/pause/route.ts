import { NextRequest, NextResponse } from "next/server";
import { pauseSession, createSessionId, createEvent, EventCategory, EVENT_TYPES } from "@agentops/core";
import { getSession, updateSession, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.status !== "active") {
      return NextResponse.json(
        { error: `Cannot pause session with status "${session.status}"` },
        { status: 400 },
      );
    }

    const paused = pauseSession(session);
    updateSession(db(), paused.id, {
      status: paused.status,
      updatedAt: paused.updatedAt,
    });

    const event = createEvent(
      EventCategory.Session,
      EVENT_TYPES["session.paused"],
      paused.id as string,
      { sessionId: paused.id },
    );
    insertEvent(db(), event);

    return NextResponse.json(paused);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
