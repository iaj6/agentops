import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get("status") ?? undefined;
    const limit = params.get("limit") ? Number(params.get("limit")) : 50;
    const offset = params.get("offset") ? Number(params.get("offset")) : 0;

    const sessions = listSessions(db(), { status, limit, offset });
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
