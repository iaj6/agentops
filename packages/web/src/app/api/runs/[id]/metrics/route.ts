import { NextRequest, NextResponse } from "next/server";
import { getRunMetrics } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const metrics = getRunMetrics(db(), createRunId(id));
    if (!metrics) {
      return NextResponse.json({ error: "Metrics not found" }, { status: 404 });
    }
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
