import { NextRequest, NextResponse } from "next/server";
import { listPolicies, insertPolicy, getPolicyStats } from "@agentops/db";
import { createPolicyId, PolicyType, PolicySeverity } from "@agentops/core";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { getRequestUser } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = db();
    const policies = listPolicies(database);

    const policiesWithStats = policies.map((policy) => {
      const stats = getPolicyStats(database, policy.id);
      return { ...policy, stats };
    });

    return NextResponse.json(policiesWithStats);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { name, type, config, severity } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "name is required and must be a string" },
        { status: 400 },
      );
    }

    if (!type || typeof type !== "string") {
      return NextResponse.json(
        { error: "type is required and must be a string" },
        { status: 400 },
      );
    }

    if (!config || typeof config !== "object") {
      return NextResponse.json(
        { error: "config is required and must be an object" },
        { status: 400 },
      );
    }

    if (type === "testEnforcement" || (config as { type?: unknown }).type === "testEnforcement") {
      return NextResponse.json(
        { error: "testEnforcement policy type is no longer supported — hooks cannot observe test results from command output" },
        { status: 400 },
      );
    }

    if (!severity || typeof severity !== "string") {
      return NextResponse.json(
        { error: "severity is required and must be a string" },
        { status: 400 },
      );
    }

    const id = createPolicyId(`pol_${randomUUID().slice(0, 8)}`);

    insertPolicy(db(), {
      id,
      name,
      type: type as PolicyType,
      config,
      severity: severity as PolicySeverity,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const me = await getRequestUser(request);
    recordAudit(request, me?.id ?? null, AUDIT_ACTIONS.POLICY_CREATED, {
      targetType: "policy",
      targetId: id as string,
      metadata: { name, type, severity },
    });

    return NextResponse.json({ id, name, type, config, severity, enabled: true }, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
