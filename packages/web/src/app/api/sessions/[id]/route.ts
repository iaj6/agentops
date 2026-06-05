import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@agentops/db";
import { createSessionId, terminateSession } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser, checkSameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (user.role !== "admin" && session.userId !== user.id) {
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
  const csrf = checkSameOrigin(request);
  if (csrf) return csrf;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (user.role !== "admin" && session.userId !== user.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action as string;

    let updated;
    switch (action) {
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
