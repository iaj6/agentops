import { NextRequest, NextResponse } from "next/server";
import {
  createEvent,
  EVENT_TYPES,
  EventCategory,
  evaluatePreToolPolicies,
  PolicySeverity,
  type GuardContext,
} from "@agentops/core";
import { insertEvent, insertPolicyResult, listPolicies } from "@agentops/db";
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
      const violationEvent = createEvent(
        EventCategory.Policy,
        EVENT_TYPES["policy.violated"],
        body.runId,
        {
          runId: body.runId,
          toolName: body.toolName,
          toolInput: Object.keys((body.toolInput as Record<string, unknown>) ?? {}),
          violations: errors,
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
      // without distinguishing source.
      //
      // PolicyViolation.policy holds the policy NAME (a string the
      // hook displays); resolve it back to the FK-valid policy ID
      // via the activePolicies list we already loaded.
      const policyIdByName = new Map<string, string>();
      for (const p of activePolicies) policyIdByName.set(p.name, p.id as string);
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
      return NextResponse.json({
        decision: "block",
        reason: errors.map((v) => `[${v.policy}] ${v.message}`).join("; "),
        violations: errors,
        warnings,
      });
    }
    return NextResponse.json({ decision: "allow", warnings });
  } catch (error) {
    return internalError(request, error, "sdk/policy/check");
  }
}
