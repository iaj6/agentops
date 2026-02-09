import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(db(), createRunId(id));
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
