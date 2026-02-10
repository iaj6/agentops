import { NextResponse } from "next/server";
import { releaseExpiredLocks } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const count = releaseExpiredLocks(db());
  return NextResponse.json({ released: count });
}
