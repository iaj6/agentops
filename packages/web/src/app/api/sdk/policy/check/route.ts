import { NextRequest, NextResponse } from "next/server";
import {
  createEvent,
  EVENT_TYPES,
  EventCategory,
  evaluatePreToolPolicies,
  PolicySeverity,
  type GuardContext,
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
  const { run } = ownership;

  try {
    const activePolicies = listPolicies(db(), { enabled: true });

    // Default branch + editedFiles from the run we already loaded — the
    // hook has them on disk too, but we hold the authoritative copy and
    // don't need to wire it through the request body. Explicit values in
    // the body override (useful for tests).
    const editedFiles =
      Array.isArray(body.editedFiles)
        ? new Set((body.editedFiles as unknown[]).filter((s): s is string => typeof s === "string"))
        : new Set(run.actions.flatMap((a) => a.fileEdits.map((e) => e.path)));

    const branch =
      typeof body.branch === "string" ? body.branch : run.environment.branch;

    const context: GuardContext = {
      editedFiles,
      branch,
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
      // Mirror DirectOps: emit a policy.violated event so the dashboard's
      // event feed and webhook subscribers see the block. Without this,
      // SDK-mode pre-tool blocks would be invisible in the audit trail
      // (only run.complete's final policy check would fire webhooks).
      // Resolve violation names → IDs once and stash the IDs on the
      // event payload so the EventCard (and downstream consumers) can
      // cross-link to /policies/<id> without a name → id lookup.
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
          toolName: body.toolName,
          toolInput: Object.keys((body.toolInput as Record<string, unknown>) ?? {}),
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

      // Also persist a policy_result row per violation so the Policy
      // detail page's Evaluation History accumulates the live block
      // trail (B4). One row per fired policy — same shape used by the
      // run-completion rollup so the page can group by policyId
      // without distinguishing source. Reuses policyIdByName from the
      // event-emission step above.
      const now = new Date().toISOString();
      for (const v of errors) {
        const policyId = policyIdByName.get(v.policy);
        if (!policyId) continue; // shouldn't happen — engine only fires from active set
        insertPolicyResult(db(), {
          id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          runId: body.runId,
          policyId,
          passed: false,
          message: v.message,
          details: {
            source: "pre-tool",
            toolName: body.toolName,
            severity: v.severity,
          },
          evaluatedAt: now,
        });
      }
      // Even on a block, still run the budget check below — a block
      // doesn't mean the user hasn't already crossed a threshold this
      // period, and we want the admin notified either way.
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
    return internalError(request, error, "sdk/policy/check");
  }
}

// Budget threshold check. Fires `budget.warning` and `budget.breached`
// events with per-period dedupe via user_budgets.last_*_at columns —
// at most one of each per (user, period). Runs after the policy
// decision so a hook that's about to be blocked still triggers the
// alert (the admin wants to know either way). Never throws — budget
// is an observability add-on and must not break the hook path.
function checkBudgetThreshold(
  userId: string | null,
  body: CheckBody,
  run: { id: unknown; createdAt: string; metrics: { costUsd: number } },
): void {
  try {
    if (!userId) return;
    const d = db();
    const budget = getBudget(d, userId);
    if (!budget) return;

    // Use the user's existing runs as the period spend baseline, then
    // overlay the live session cost from the request (the hook knows
    // it from the local transcript). This way we count today's spend
    // even if the current run's DB row hasn't been updated yet.
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
    // Swallow — budget telemetry should never break the hook path.
    console.error("budget check failed:", err);
  }
}
