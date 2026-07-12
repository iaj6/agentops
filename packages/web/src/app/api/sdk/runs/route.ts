import { NextRequest, NextResponse } from "next/server";
import type { Goal, Environment, Agent } from "@agentops/core";
import {
  createRun,
  startRun,
  assignRun,
  createAgentId,
  createSessionId,
  createEvent,
  EventCategory,
  EVENT_TYPES,
  normalizeRepo,
  AgentRole,
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

    // agents: validate-if-present and persist. StartRunRequest declares
    // agents, and dropping them here left run.agents forever [] — the
    // dashboard could never attribute an SDK run to the model/role that
    // performed it. Optional so minimal clients keep working.
    const validRoles = new Set<string>(Object.values(AgentRole));
    const rawAgents = body.agents;
    if (rawAgents !== undefined) {
      const shapeOk =
        Array.isArray(rawAgents) &&
        rawAgents.every((a: unknown) => {
          if (a === null || typeof a !== "object") return false;
          const agent = a as Record<string, unknown>;
          return (
            typeof agent.id === "string" &&
            agent.id.length > 0 &&
            typeof agent.model === "string" &&
            agent.model.length > 0 &&
            typeof agent.role === "string" &&
            validRoles.has(agent.role)
          );
        });
      if (!shapeOk) {
        return NextResponse.json(
          {
            error: `agents must be an array of { id, model, role } objects with role one of: ${[...validRoles].join(", ")}`,
          },
          { status: 400 },
        );
      }
    }
    const agents: ReadonlyArray<Agent> = (
      (rawAgents as Array<{ id: string; model: string; role: string }> | undefined) ?? []
    ).map((a) => ({
      id: createAgentId(a.id),
      model: a.model,
      role: a.role as AgentRole,
    }));

    // Canonicalize the repo identity at the write boundary so SDK-supplied
    // values bucket the same way as CLI-produced ones (lowercase owner/name);
    // otherwise the same repo fragments across the dashboard's analytics.
    const normalizedEnvironment: Environment = {
      ...environment,
      repo: normalizeRepo(environment.repo),
    };
    // A non-empty-but-degenerate repo (e.g. a host-only URL or a lone slash)
    // can normalize to "". Reject rather than persist an empty bucket — the
    // raw-value check above only guarantees the *input* was non-empty.
    if (!normalizedEnvironment.repo) {
      return NextResponse.json(
        { error: "environment.repo did not resolve to a valid repository identity" },
        { status: 400 },
      );
    }

    const baseRun = startRun(createRun(goal, normalizedEnvironment));
    // Tag the run with the authenticated user so the dashboard can scope
    // by owner, and attach the reported agents at creation (runs are
    // immutable — spread into a new object, never mutate).
    const run = { ...baseRun, agents, userId: user.id };

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
