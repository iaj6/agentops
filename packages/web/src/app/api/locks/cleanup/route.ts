import { NextResponse } from "next/server";
import { releaseExpiredLocks } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const count = releaseExpiredLocks(db());
    return NextResponse.json({ released: count });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
