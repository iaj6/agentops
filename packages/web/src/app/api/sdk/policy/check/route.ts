import { NextRequest, NextResponse } from "next/server";
import {
  evaluatePreToolPolicies,
  PolicySeverity,
  type GuardContext,
} from "@agentops/core";
import { listPolicies } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Pre-tool guard evaluation. Hooks call this before each tool invocation,
// providing the tool the agent is about to run and the locally-computed
// cumulative cost (the transcript stays on the hook's machine; we never
// upload it). The server replies allow/block with the same logic the
// hook uses in local-DB mode — one source of truth in @agentops/core.

interface CheckBody {
  runId?: unknown;
  toolName?: unknown;
  toolInput?: unknown;
  cumulativeCostUsd?: unknown;
  branch?: unknown;
  editedFiles?: unknown;
}

export async function POST(request: NextRequest) {
  let body: CheckBody;
  try {
    body = (await request.json()) as CheckBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.runId !== "string" || body.runId.length === 0) {
    return NextResponse.json(
      { error: "runId is required and must be a string" },
      { status: 400 },
    );
  }
  if (typeof body.toolName !== "string") {
    return NextResponse.json(
      { error: "toolName is required and must be a string" },
      { status: 400 },
    );
  }
  if (body.toolInput !== undefined && (typeof body.toolInput !== "object" || body.toolInput === null)) {
    return NextResponse.json(
      { error: "toolInput must be an object" },
      { status: 400 },
    );
  }

  const ownership = await requireOwnedRun(request, body.runId);
  if (ownership instanceof NextResponse) return ownership;

  try {
    const activePolicies = listPolicies(db(), { enabled: true });

    const editedFiles =
      Array.isArray(body.editedFiles)
        ? new Set((body.editedFiles as unknown[]).filter((s): s is string => typeof s === "string"))
        : undefined;

    const context: GuardContext = {
      ...(editedFiles ? { editedFiles } : {}),
      ...(typeof body.branch === "string" ? { branch: body.branch } : {}),
      ...(typeof body.cumulativeCostUsd === "number"
        ? { cumulativeCostUsd: body.cumulativeCostUsd }
        : {}),
    };

    const violations = evaluatePreToolPolicies(
      {
        toolName: body.toolName,
        toolInput: (body.toolInput as Record<string, unknown>) ?? {},
      },
      activePolicies,
      context,
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    const warnings = violations.filter((v) => v.severity !== PolicySeverity.Error);

    if (errors.length > 0) {
      return NextResponse.json({
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      });
    }
    return NextResponse.json({ decision: "allow", warnings });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
