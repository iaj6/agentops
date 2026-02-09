import { NextRequest, NextResponse } from "next/server";
import { getPolicyResults } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const results = getPolicyResults(db(), createRunId(id));
  return NextResponse.json(results);
}
