import { NextRequest, NextResponse } from "next/server";
import { createRunId, PolicyEngine } from "@agentops/core";
import { getRun, listPolicies } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const runId = body.runId as string | undefined;
    if (!runId || typeof runId !== "string") {
      return NextResponse.json(
        { error: "runId is required and must be a string" },
        { status: 400 },
      );
    }

    const run = getRun(db(), createRunId(runId));
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const activePolicies = listPolicies(db(), { enabled: true });
    const engine = new PolicyEngine();
    const results = engine.evaluate(run, activePolicies);

    const violations = results.filter((r) => !r.passed);
    const permit = violations.length === 0;

    return NextResponse.json({ permit, violations });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
