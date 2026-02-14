import { NextResponse } from "next/server";
import { getActiveSessions, countActiveSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = getActiveSessions(db());
    const count = countActiveSessions(db());
    return NextResponse.json({ sessions, count });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
