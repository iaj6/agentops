import { NextRequest, NextResponse } from "next/server";
import { getPolicy, updatePolicy, getPolicyStats } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const database = db();
  const policy = getPolicy(database, createPolicyId(id));

  if (!policy) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  const stats = getPolicyStats(database, policy.id);
  return NextResponse.json({ ...policy, stats });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const database = db();
  const policyId = createPolicyId(id);
  const existing = getPolicy(database, policyId);

  if (!existing) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  const body = await request.json();
  const updates: { name?: string; config?: unknown; severity?: string; enabled?: boolean } = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.config !== undefined) updates.config = body.config;
  if (body.severity !== undefined) updates.severity = body.severity;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  updatePolicy(database, policyId, updates);

  const updated = getPolicy(database, policyId);
  return NextResponse.json(updated);
}
