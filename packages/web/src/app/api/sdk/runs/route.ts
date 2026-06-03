import { NextRequest, NextResponse } from "next/server";
import type { Goal, Environment } from "@agentops/core";
import {
  createRun,
  startRun,
  assignRun,
  createSessionId,
  createEvent,
  EventCategory,
  EVENT_TYPES,
} from "@agentops/core";
import { insertRun, insertEvent, getSession, updateSession } from "@agentops/db";
import { db } from "@/lib/db";
import { requireBearerUser } from "@/lib/auth";
import { internalError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await requireBearerUser(request);
  if (user instanceof NextResponse) return user;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const goal = body.goal as unknown as Goal | undefined;
    const environment = body.environment as unknown as Environment | undefined;

    if (!goal || typeof goal !== "object") {
      return NextResponse.json(
        { error: "goal is required and must be an object" },
        { status: 400 },
      );
    }

    if (!goal.humanReadable || typeof goal.humanReadable !== "string") {
      return NextResponse.json(
        { error: "goal.humanReadable is required and must be a string" },
        { status: 400 },
      );
    }

    if (!environment || typeof environment !== "object") {
      return NextResponse.json(
        { error: "environment is required and must be an object" },
        { status: 400 },
      );
    }

    if (!environment.repo || typeof environment.repo !== "string") {
      return NextResponse.json(
        { error: "environment.repo is required and must be a string" },
        { status: 400 },
      );
    }

    // Validate-if-present: don't break minimal clients, but reject wrong-typed
    // values that would corrupt persisted records (environment.branch feeds a
    // dedicated DB column; goal.structured is read by summary/scoring).
    if (environment.branch !== undefined && typeof environment.branch !== "string") {
      return NextResponse.json(
        { error: "environment.branch must be a string" },
        { status: 400 },
      );
    }
    if (goal.structured !== undefined && (typeof goal.structured !== "object" || goal.structured === null)) {
      return NextResponse.json(
        { error: "goal.structured must be an object" },
        { status: 400 },
      );
    }

    const baseRun = startRun(createRun(goal, environment));
    // Tag the run with the authenticated user so the dashboard can scope
    // by owner. Both insertRun and rowToRun round-trip this field.
    const run = { ...baseRun, userId: user.id };

    insertRun(db(), run);

    // If sessionId provided, attach the run to the session — but only if
    // the caller actually owns that session (or is admin).
    const sessionId = body.sessionId as string | undefined;
    if (sessionId) {
      const session = getSession(db(), createSessionId(sessionId));
      if (session && (user.role === "admin" || session.userId === user.id)) {
        const updated = assignRun(session, run.id);
        updateSession(db(), updated.id, {
          currentRunId: updated.currentRunId,
          // Persist the archived prior run too — assignRun moves any existing
          // currentRunId into completedRunIds, which is otherwise lost here.
          completedRunIds: updated.completedRunIds,
          updatedAt: updated.updatedAt,
        });
      }
    }

    const event = createEvent(
      EventCategory.Run,
      EVENT_TYPES["run.started"],
      run.id as string,
      { runId: run.id, goal: run.goal.humanReadable },
    );
    insertEvent(db(), event);

    return NextResponse.json({ runId: run.id, status: run.status }, { status: 201 });
  } catch (error) {
    return internalError(request, error, "sdk/runs");
  }
}
