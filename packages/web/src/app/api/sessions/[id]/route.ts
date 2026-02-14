import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@agentops/db";
import { createSessionId, pauseSession, resumeSession, terminateSession } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action as string;

    let updated;
    switch (action) {
      case "pause":
        updated = pauseSession(session);
        break;
      case "resume":
        updated = resumeSession(session);
        break;
      case "terminate":
        updated = terminateSession(session);
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    updateSession(db(), updated.id, {
      status: updated.status,
      terminatedAt: updated.terminatedAt,
      updatedAt: updated.updatedAt,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
