import { NextRequest, NextResponse } from "next/server";
import { listPolicies, insertPolicy, getPolicyStats } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = db();
  const policies = listPolicies(database);

  const policiesWithStats = policies.map((policy) => {
    const stats = getPolicyStats(database, policy.id);
    return { ...policy, stats };
  });

  return NextResponse.json(policiesWithStats);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { name, type, config, severity } = body;

  if (!name || !type || !config || !severity) {
    return NextResponse.json(
      { error: "Missing required fields: name, type, config, severity" },
      { status: 400 },
    );
  }

  const id = createPolicyId(`pol_${randomUUID().slice(0, 8)}`);

  insertPolicy(db(), {
    id,
    name,
    type,
    config,
    severity,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ id, name, type, config, severity, enabled: true }, { status: 201 });
}
