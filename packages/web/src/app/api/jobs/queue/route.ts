import { NextRequest, NextResponse } from "next/server";
import { getQueuedJobs } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const limit = params.get("limit") ? Number(params.get("limit")) : 50;

    const jobs = getQueuedJobs(db(), limit);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
