import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? undefined;
  const limit = params.get("limit") ? Number(params.get("limit")) : 50;
  const offset = params.get("offset") ? Number(params.get("offset")) : 0;

  const sessions = listSessions(db(), { status, limit, offset });
  return NextResponse.json(sessions);
}
