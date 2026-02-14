import { NextRequest, NextResponse } from "next/server";
import { resumeSession, createSessionId, createEvent, EventCategory } from "@agentops/core";
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

    if (session.status !== "paused") {
      return NextResponse.json(
        { error: `Cannot resume session with status "${session.status}"` },
        { status: 400 },
      );
    }

    const resumed = resumeSession(session);
    updateSession(db(), resumed.id, {
      status: resumed.status,
      updatedAt: resumed.updatedAt,
    });

    const event = createEvent(
      EventCategory.Session,
      "session.resumed",
      resumed.id as string,
      { sessionId: resumed.id },
    );
    insertEvent(db(), event);

    return NextResponse.json(resumed);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
