import { NextRequest, NextResponse } from "next/server";
import { getPolicyResultsForPolicy } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    // Policy results reference runs across every user. Members only see
    // results for their own runs; admins see everything (matching the
    // view-scoping rules used by the runs/sessions lists).
    const results = getPolicyResultsForPolicy(
      db(),
      createPolicyId(id),
      user.role === "admin" ? undefined : user.id,
    );
    return NextResponse.json(results);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
