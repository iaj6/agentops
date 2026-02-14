import { NextRequest, NextResponse } from "next/server";
import { listEvents, countEvents } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const category = params.get("category") ?? undefined;
    const type = params.get("type") ?? undefined;
    const sourceId = params.get("sourceId") ?? undefined;
    const since = params.get("since") ?? undefined;
    const until = params.get("until") ?? undefined;
    const limit = parseInt(params.get("limit") ?? "50", 10);
    const offset = parseInt(params.get("offset") ?? "0", 10);

    const filters = { category, type, sourceId, since, until, limit, offset };
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
