import { NextRequest, NextResponse } from "next/server";
import {
  completeRun,
  createRunId,
  computeScore,
  PolicyEngine,
  createEvent,
  EventCategory,
  EVENT_TYPES,
  generateSummary,
} from "@agentops/core";
import type { Evaluation } from "@agentops/core";
import { getRun, updateRun, insertEvent, listPolicies, updateRunSummary } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = getRun(db(), createRunId(id));
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

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

    // Emit policy violation events for any failing policies
    const engine = new PolicyEngine();
    const policyResults = engine.evaluate(completed, activePolicies);
    for (const result of policyResults) {
      if (!result.passed) {
        const violationEvent = createEvent(
          EventCategory.Policy,
          EVENT_TYPES["policy.violated"],
          completed.id as string,
          { runId: completed.id, policy: result.policy.name, message: result.message },
        );
        insertEvent(db(), violationEvent);
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
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
