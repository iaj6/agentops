import { NextRequest, NextResponse } from "next/server";
import { createSession, activateSession, createEvent, EventCategory, EVENT_TYPES } from "@agentops/core";
import { insertSession, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";
import { requireBearerUser } from "@/lib/auth";
import { internalError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await requireBearerUser(request);
  if (user instanceof NextResponse) return user;

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

    const baseSession = activateSession(createSession(agentId, metadata));
    const session = { ...baseSession, userId: user.id };
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
    return internalError(request, error, "sdk/sessions");
  }
}
