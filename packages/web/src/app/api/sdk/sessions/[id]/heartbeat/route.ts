import { NextRequest, NextResponse } from "next/server";
import { updateHeartbeat, updateResourceUsage, createSessionId } from "@agentops/core";
import type { ResourceUsage } from "@agentops/core";
import { getSession, updateSession } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getSession(db(), createSessionId(id));
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (body.resourceUsage !== undefined && typeof body.resourceUsage !== "object") {
      return NextResponse.json(
        { error: "resourceUsage must be an object" },
        { status: 400 },
      );
    }

    let updated = updateHeartbeat(session);

    // Optionally update resource usage if provided
    const resourceUsage = body.resourceUsage as ResourceUsage | undefined;
    if (resourceUsage) {
      updated = updateResourceUsage(updated, resourceUsage);
    }

    updateSession(db(), updated.id, {
      lastHeartbeatAt: updated.lastHeartbeatAt,
      resourceUsage: updated.resourceUsage,
      updatedAt: updated.updatedAt,
    });

    return NextResponse.json({ ok: true, commands: [] });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
