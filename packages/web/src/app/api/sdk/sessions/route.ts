import { NextRequest, NextResponse } from "next/server";
import { createSession, activateSession, createEvent, EventCategory, EVENT_TYPES } from "@agentops/core";
import { insertSession, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const agentId = body.agentId as string | undefined;
    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json(
        { error: "agentId is required and must be a string" },
        { status: 400 },
      );
    }

    if (body.metadata !== undefined && typeof body.metadata !== "object") {
      return NextResponse.json(
        { error: "metadata must be an object" },
        { status: 400 },
      );
    }

    const metadata = (body.metadata as Record<string, unknown>) ?? {};

    const session = activateSession(createSession(agentId, metadata));
    insertSession(db(), session);

    const event = createEvent(
      EventCategory.Session,
      EVENT_TYPES["session.started"],
      session.id as string,
      { agentId, sessionId: session.id },
    );
    insertEvent(db(), event);

    return NextResponse.json({ sessionId: session.id, status: session.status }, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
