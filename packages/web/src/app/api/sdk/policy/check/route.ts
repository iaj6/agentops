import { NextRequest, NextResponse } from "next/server";
import { PolicyEngine } from "@agentops/core";
import { listPolicies } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

  const ownership = await requireOwnedRun(request, runId);
  if (ownership instanceof NextResponse) return ownership;
  const { run } = ownership;

  try {

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
