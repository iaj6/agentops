import { NextResponse } from "next/server";
import { getActiveSessions, countActiveSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = getActiveSessions(db());
  const count = countActiveSessions(db());
  return NextResponse.json({ sessions, count });
}
