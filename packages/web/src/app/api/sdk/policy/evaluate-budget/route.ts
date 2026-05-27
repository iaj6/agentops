import { NextRequest, NextResponse } from "next/server";
import {
  evaluateBudgetPolicies,
  evaluateBudgetWarnings,
  PolicySeverity,
} from "@agentops/core";
import { listPolicies } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";
import { internalError } from "@/lib/log";

export const dynamic = "force-dynamic";

// Read-only budget evaluation. Same math as /api/sdk/policy/check-budget
// but no side effects: no policy.violated event, no policy_result row,
// no per-user budget threshold check. Stop hooks call this on every
// Claude response — duplicate writes from a chat-heavy session would
// otherwise pile up turn-by-turn.

interface EvaluateBudgetBody {
  runId?: unknown;
  cumulativeCostUsd?: unknown;
}

export async function POST(request: NextRequest) {
  let body: EvaluateBudgetBody;
  try {
    body = (await request.json()) as EvaluateBudgetBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.runId !== "string" || body.runId.length === 0) {
    return NextResponse.json(
      { error: "runId is required and must be a string" },
      { status: 400 },
    );
  }
  if (typeof body.cumulativeCostUsd !== "number") {
    return NextResponse.json(
      { error: "cumulativeCostUsd is required and must be a number" },
      { status: 400 },
    );
  }

  const ownership = await requireOwnedRun(request, body.runId);
  if (ownership instanceof NextResponse) return ownership;

  try {
    const activePolicies = listPolicies(db(), { enabled: true });

    const violations = evaluateBudgetPolicies(
      { cumulativeCostUsd: body.cumulativeCostUsd },
      activePolicies,
    );
    const approaching = evaluateBudgetWarnings(
      { cumulativeCostUsd: body.cumulativeCostUsd },
      activePolicies,
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    const warnings = [
      ...violations.filter((v) => v.severity !== PolicySeverity.Error),
      ...approaching,
    ];

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
    return internalError(request, error, "sdk/policy/evaluate-budget");
  }
}
