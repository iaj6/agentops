import { NextRequest, NextResponse } from "next/server";
import {
  createEvent,
  EVENT_TYPES,
  EventCategory,
  evaluateBudgetPolicies,
  PolicySeverity,
  computeBudgetState,
  pickBudgetEvent,
} from "@agentops/core";
import {
  getBudget,
  insertEvent,
  insertPolicyResult,
  listPolicies,
  listRuns,
  markThresholdFired,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";
import { internalError } from "@/lib/log";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

export const dynamic = "force-dynamic";

// Turn-boundary policy evaluation. The UserPromptSubmit and Stop hook
// handlers call this between turns, so chat-only sessions (no tool calls,
// so PreToolUse never fires) still hit a budget gate. The hook computes
// cumulative cost from the local transcript and we evaluate the same
// policy set against it — one source of truth in @agentops/core.

interface CheckBudgetBody {
  runId?: unknown;
  cumulativeCostUsd?: unknown;
}

export async function POST(request: NextRequest) {
  let body: CheckBudgetBody;
  try {
    body = (await request.json()) as CheckBudgetBody;
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
  const { run } = ownership;

  try {
    const activePolicies = listPolicies(db(), { enabled: true });

    const violations = evaluateBudgetPolicies(
      { cumulativeCostUsd: body.cumulativeCostUsd },
      activePolicies,
    );

    const errors = violations.filter((v) => v.severity === PolicySeverity.Error);
    const warnings = violations.filter((v) => v.severity !== PolicySeverity.Error);

    if (errors.length > 0) {
      // Emit policy.violated + write policy_result, mirroring the
      // PreToolUse path so the audit trail and webhook subscribers see
      // the block regardless of which gate caught it. source="turn-
      // boundary" lets the Policy detail page distinguish chat-turn
      // blocks from pre-tool blocks.
      const policyIdByName = new Map<string, string>();
      for (const p of activePolicies) policyIdByName.set(p.name, p.id as string);
      const policyIds = errors
        .map((v) => policyIdByName.get(v.policy))
        .filter((id): id is string => !!id);

      const violationEvent = createEvent(
        EventCategory.Policy,
        EVENT_TYPES["policy.violated"],
        body.runId,
        {
          runId: body.runId,
          source: "turn-boundary",
          violations: errors,
          policyIds,
        },
      );
      insertEvent(db(), violationEvent);
      void dispatchWebhookEvent(db(), {
        id: violationEvent.id as string,
        type: violationEvent.type,
        payload: violationEvent.payload,
        timestamp: violationEvent.timestamp,
      });

      const now = new Date().toISOString();
      for (const v of errors) {
        const policyId = policyIdByName.get(v.policy);
        if (!policyId) continue;
        insertPolicyResult(db(), {
          id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          runId: body.runId,
          policyId,
          passed: false,
          message: v.message,
          details: {
            source: "turn-boundary",
            severity: v.severity,
          },
          evaluatedAt: now,
        });
      }

      // Even on a block, still run the per-user budget threshold check
      // — same reasoning as /api/sdk/policy/check.
      void checkBudgetThreshold(run.userId ?? null, body, run);
      return NextResponse.json({
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      });
    }

    void checkBudgetThreshold(run.userId ?? null, body, run);
    return NextResponse.json({ decision: "allow", warnings });
  } catch (error) {
    return internalError(request, error, "sdk/policy/check-budget");
  }
}

// Mirror of /api/sdk/policy/check's per-user budget threshold check.
// Same dedupe behavior (at most one warning + one breach per period),
// same swallow-all-errors stance — budget telemetry must not break
// the hook path.
function checkBudgetThreshold(
  userId: string | null,
  body: CheckBudgetBody,
  run: { id: unknown; createdAt: string; metrics: { costUsd: number } },
): void {
  try {
    if (!userId) return;
    const d = db();
    const budget = getBudget(d, userId);
    if (!budget) return;

    const allRuns = listRuns(d, { userId, limit: 1000 });
    const otherRuns = allRuns.filter((r) => (r.id as string) !== (run.id as string));
    const sessionCost =
      typeof body.cumulativeCostUsd === "number"
        ? body.cumulativeCostUsd
        : run.metrics.costUsd ?? 0;
    const runsForCheck = [
      ...otherRuns.map((r) => ({
        createdAt: r.createdAt,
        metrics: r.metrics,
      })),
      {
        createdAt: run.createdAt,
        metrics: { ...run.metrics, costUsd: sessionCost },
      },
    ];

    const state = computeBudgetState(budget, runsForCheck);
    const event = pickBudgetEvent(state, budget.lastWarnAt, budget.lastBreachAt);
    if (!event) return;

    const now = new Date().toISOString();
    const eventType =
      event === "breached"
        ? EVENT_TYPES["budget.breached"]
        : EVENT_TYPES["budget.warning"];
    const agentEvent = createEvent(EventCategory.Cost, eventType, userId, {
      userId,
      runId: run.id as string,
      spent: state.spent,
      amountUsd: budget.amountUsd,
      pct: state.pct,
      period: budget.period,
      periodStart: state.periodStart,
    });
    insertEvent(d, agentEvent);
    void dispatchWebhookEvent(d, {
      id: agentEvent.id as string,
      type: agentEvent.type,
      payload: agentEvent.payload,
      timestamp: agentEvent.timestamp,
    });
    markThresholdFired(d, userId, event, now);
  } catch (err) {
    console.error("budget check failed:", err);
  }
}
