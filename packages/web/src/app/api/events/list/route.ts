import { NextRequest, NextResponse } from "next/server";
import { listEvents, countEvents } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";
import { resolveOwnedSourceIds } from "@/lib/event-scope";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const params = request.nextUrl.searchParams;
    const scope = resolveViewScope(user, params);

    const category = params.get("category") ?? undefined;
    const type = params.get("type") ?? undefined;
    const sourceId = params.get("sourceId") ?? undefined;
    const since = params.get("since") ?? undefined;
    const until = params.get("until") ?? undefined;
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const offset = parseInt(params.get("offset") ?? "0", 10);

    // Events have no userId column. Resolve the user's owned runs +
    // sessions and use their IDs to scope. Empty array means "user
    // owns nothing yet" — must match no events, not the team view.
    const sourceIds = resolveOwnedSourceIds(scope.userId);

    const filters = {
      category,
      type,
      sourceId,
      ...(sourceIds ? { sourceIds } : {}),
      since,
      until,
      limit,
      offset,
    };
    const events = listEvents(db(), filters);
    const total = countEvents(db(), filters);

    return NextResponse.json({ events, total });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
