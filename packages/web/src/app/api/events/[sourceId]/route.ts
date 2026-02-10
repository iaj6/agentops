import { NextRequest, NextResponse } from "next/server";
import { getEventsBySource } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);

  const events = getEventsBySource(db(), sourceId, limit);
  return NextResponse.json(events);
}
