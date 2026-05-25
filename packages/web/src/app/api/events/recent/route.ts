import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";
import { resolveOwnedSourceIds } from "@/lib/event-scope";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get("limit") ?? "15"),
      50,
    );
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    const sourceIds = resolveOwnedSourceIds(scope.userId);

    // Switched from getRecentEvents to listEvents so the sourceIds
    // filter can apply. Order/limit semantics unchanged (listEvents
    // also orders by timestamp desc).
    const events = listEvents(db(), {
      limit,
      ...(sourceIds ? { sourceIds } : {}),
    });
    return NextResponse.json(events);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
