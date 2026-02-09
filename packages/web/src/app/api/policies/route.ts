import { NextResponse } from "next/server";
import { listPolicies } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const policies = listPolicies(db());
  return NextResponse.json(policies);
}
