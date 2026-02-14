import { NextRequest, NextResponse } from "next/server";
import { getRecentEvents } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "15");
    const events = getRecentEvents(db(), Math.min(limit, 50));
    return NextResponse.json(events);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
