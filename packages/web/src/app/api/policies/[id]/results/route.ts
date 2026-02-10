import { NextRequest, NextResponse } from "next/server";
import { getPolicyResultsForPolicy } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const results = getPolicyResultsForPolicy(db(), createPolicyId(id));
  return NextResponse.json(results);
}
