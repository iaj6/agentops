import { NextRequest, NextResponse } from "next/server";
import { getPolicy, updatePolicy, deletePolicy, getPolicyStats } from "@agentops/db";
import { createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const database = db();
    const policy = getPolicy(database, createPolicyId(id));

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const stats = getPolicyStats(database, policy.id);
    return NextResponse.json({ ...policy, stats });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
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
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const database = db();
    const policyId = createPolicyId(id);
    const existing = getPolicy(database, policyId);

    if (!existing) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, config, severity, enabled } = body;

    if (!name || !config || !severity) {
      return NextResponse.json(
        { error: "Missing required fields: name, config, severity" },
        { status: 400 },
      );
    }

    updatePolicy(database, policyId, { name, config, severity, enabled });

    const updated = getPolicy(database, policyId);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const database = db();
    const policyId = createPolicyId(id);
    const existing = getPolicy(database, policyId);

    if (!existing) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    deletePolicy(database, policyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
