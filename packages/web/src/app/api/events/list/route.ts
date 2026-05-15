import { NextRequest, NextResponse } from "next/server";
import { listEvents, countEvents, listRuns, listSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const category = params.get("category") ?? undefined;
    const type = params.get("type") ?? undefined;
    const sourceId = params.get("sourceId") ?? undefined;
    const userId = params.get("userId") ?? undefined;
    const since = params.get("since") ?? undefined;
    const until = params.get("until") ?? undefined;
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const offset = parseInt(params.get("offset") ?? "0", 10);

    // Events don't carry a userId of their own — resolve it via the
    // owning run or session. We collect the user's sourceIds once and
    // pass them as a filter; listEvents handles the empty-array case
    // (matches nothing) so "no runs yet" doesn't accidentally show
    // everyone's events.
    let sourceIds: string[] | undefined;
    if (userId) {
      const d = db();
      const runs = listRuns(d, { userId, limit: 10000 });
      const sessions = listSessions(d, { userId, limit: 10000 });
      sourceIds = Array.from(
        new Set<string>([
          ...runs.map((r) => r.id as string),
          ...sessions.map((s) => s.id as string),
        ]),
      );
    }

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
