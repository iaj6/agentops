import { NextRequest, NextResponse } from "next/server";
import {
  completeRun,
  computeScore,
  PolicyEngine,
  createEvent,
  EventCategory,
  EVENT_TYPES,
  generateSummary,
} from "@agentops/core";
import type { Evaluation } from "@agentops/core";
import {
  updateRun,
  insertEvent,
  insertPolicyResult,
  listPolicies,
  updateRunSummary,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";
import { internalError } from "@/lib/log";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownership = await requireOwnedRun(request, id);
    if (ownership instanceof NextResponse) return ownership;
    const { run } = ownership;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (body.testResults !== undefined && !Array.isArray(body.testResults)) {
      return NextResponse.json(
        { error: "testResults must be an array" },
        { status: 400 },
      );
    }

    if (body.policyChecks !== undefined && !Array.isArray(body.policyChecks)) {
      return NextResponse.json(
        { error: "policyChecks must be an array" },
        { status: 400 },
      );
    }

    if (body.confidenceScore !== undefined && typeof body.confidenceScore !== "number") {
      return NextResponse.json(
        { error: "confidenceScore must be a number" },
        { status: 400 },
      );
    }

    const evaluation: Evaluation = {
      testResults: (body.testResults as Evaluation["testResults"]) ?? [],
      policyChecks: (body.policyChecks as Evaluation["policyChecks"]) ?? [],
      confidenceScore: (body.confidenceScore as number) ?? 0,
    };

    const completed = completeRun(run, evaluation);
    updateRun(db(), completed.id, {
      status: completed.status,
      evaluations: completed.evaluations,
      artifacts: body.artifacts
        ? [...completed.artifacts, ...(body.artifacts as typeof completed.artifacts)]
        : completed.artifacts,
      updatedAt: completed.updatedAt,
    });

    // Run policy evaluation and scoring
    const activePolicies = listPolicies(db(), { enabled: true });
    const score = computeScore(completed, activePolicies);

    // Run final policy evaluation + persist one policy_result row per
    // active policy as the post-run rollup (B4). The Policy detail
    // page's Evaluation History reads these rows, so without persisting
    // them every policy showed "No data" no matter how many runs went
    // through. Pre-tool blocks write additional rows during the run via
    // /api/sdk/policy/check; the run-end rollup here gives every
    // active policy a final pass/fail state.
    const engine = new PolicyEngine();
    const policyResults = engine.evaluate(completed, activePolicies);
    const evaluatedAt = new Date().toISOString();
    for (const result of policyResults) {
      insertPolicyResult(db(), {
        id: `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        runId: completed.id as string,
        policyId: result.policy.id as string,
        passed: result.passed,
        message: result.message,
        details: { ...result.details, source: "run-complete" },
        evaluatedAt,
      });

      // Emit policy violation event (+ webhook fanout) for any failing
      // policies — kept from the prior implementation so audit/webhook
      // behavior is unchanged.
      if (!result.passed) {
        const violationEvent = createEvent(
          EventCategory.Policy,
          EVENT_TYPES["policy.violated"],
          completed.id as string,
          { runId: completed.id, policy: result.policy.name, message: result.message },
        );
        insertEvent(db(), violationEvent);
        void dispatchWebhookEvent(db(), {
          id: violationEvent.id as string,
          type: violationEvent.type,
          payload: violationEvent.payload,
          timestamp: violationEvent.timestamp,
        });
      }
    }

    // Generate and persist session summary
    const summary = generateSummary(completed, completed.metrics, policyResults, score);
    updateRunSummary(db(), completed.id, summary);

    const event = createEvent(
      EventCategory.Run,
      EVENT_TYPES["run.completed"],
      completed.id as string,
      { runId: completed.id, recommendation: score.mergeRecommendation },
    );
    insertEvent(db(), event);

    return NextResponse.json({
      runId: completed.id,
      score,
      recommendation: score.mergeRecommendation,
      summary,
    });
  } catch (error) {
    return internalError(request, error, "sdk/runs/[id]/complete");
  }
}
