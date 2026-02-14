import { NextRequest, NextResponse } from "next/server";
import { getEventsBySource } from "@agentops/db";
import { buildAgentTimeline } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const events = getEventsBySource(db(), id, 500);
    const timeline = buildAgentTimeline(events);
    return NextResponse.json({ timeline });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
