import { NextRequest, NextResponse } from "next/server";
import {
  createRunId,
  createDecisionId,
  DecisionType,
  blockRun,
  createEvent,
  EventCategory,
} from "@agentops/core";
import { getRun, updateRun, insertEvent } from "@agentops/db";
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
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const decision = body.decision as string | undefined;
    const reason = body.reason as string | undefined;
    const actor = body.actor as string | undefined;

    if (!decision || typeof decision !== "string") {
      return NextResponse.json(
        { error: "decision is required and must be a string" },
        { status: 400 },
      );
    }

    if (!reason || typeof reason !== "string") {
      return NextResponse.json(
        { error: "reason is required and must be a string" },
        { status: 400 },
      );
    }

    if (!actor || typeof actor !== "string") {
      return NextResponse.json(
        { error: "actor is required and must be a string" },
        { status: 400 },
      );
    }

    if (decision !== "Approve" && decision !== "Block") {
      return NextResponse.json(
        { error: 'decision must be "Approve" or "Block"' },
        { status: 400 },
      );
    }

    if (decision === "Block") {
      const blocked = blockRun(run, actor, reason);
      updateRun(db(), blocked.id, {
        status: blocked.status,
        decisions: blocked.decisions,
        updatedAt: blocked.updatedAt,
      });

      const event = createEvent(
        EventCategory.Run,
        "run.blocked",
        blocked.id as string,
        { runId: blocked.id, actor, reason, decision },
      );
      insertEvent(db(), event);

      return NextResponse.json(blocked);
    }

    // Approve — add decision without changing status
    const newDecision = {
      id: createDecisionId(`decision_${Date.now()}`),
      type: DecisionType.Approval,
      actor,
      reason,
      timestamp: new Date().toISOString(),
    };

    const updated = {
      ...run,
      decisions: [...run.decisions, newDecision],
      updatedAt: new Date().toISOString(),
    };

    updateRun(db(), updated.id, {
      decisions: updated.decisions,
      updatedAt: updated.updatedAt,
    });

    const event = createEvent(
      EventCategory.Run,
      "run.approved",
      updated.id as string,
      { runId: updated.id, actor, reason, decision },
    );
    insertEvent(db(), event);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
