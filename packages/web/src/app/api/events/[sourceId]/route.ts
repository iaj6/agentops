import { NextRequest, NextResponse } from "next/server";
import { getEventsBySource, getRun, getSession } from "@agentops/db";
import { createRunId, createSessionId } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser, forbidden } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const { sourceId } = await params;
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);

    // Permission check: admins can read any source; members must own
    // either the run or session this sourceId points at. Events are
    // keyed by source so this is the cheapest way to gate them
    // without an explicit user join.
    if (user.role !== "admin") {
      const d = db();
      const run = getRun(d, createRunId(sourceId));
      const ownedByRun = run?.userId === user.id;
      let ownedBySession = false;
      if (!ownedByRun) {
        const session = getSession(d, createSessionId(sourceId));
        ownedBySession = session?.userId === user.id;
      }
      if (!ownedByRun && !ownedBySession) {
        return forbidden("Not authorized for this source", request);
      }
    }

    const events = getEventsBySource(db(), sourceId, limit);
    return NextResponse.json(events);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
