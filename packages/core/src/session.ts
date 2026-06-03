import type { Session, ResourceUsage, RunId } from "./types.js";
import { SessionStatus, createSessionId, createAgentId } from "./types.js";
import type { AgentId } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

let counter = 0;
function generateId(): string {
  counter++;
  return `session_${Date.now()}_${counter}`;
}

export function createSession(
  agentId: string | AgentId,
  metadata: Record<string, unknown> = {},
): Session {
  const timestamp = now();
  return {
    id: createSessionId(generateId()),
    status: SessionStatus.Provisioning,
    agentId: typeof agentId === "string" ? createAgentId(agentId) : agentId,
    currentRunId: null,
    completedRunIds: [],
    resourceUsage: {
      memoryMb: 0,
      cpuPercent: 0,
      tokensBudgetRemaining: 0,
      costBudgetRemaining: 0,
    },
    metadata,
    startedAt: timestamp,
    lastHeartbeatAt: timestamp,
    terminatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function activateSession(session: Session): Session {
  return {
    ...session,
    status: SessionStatus.Active,
    updatedAt: now(),
  };
}

export function assignRun(session: Session, runId: RunId): Session {
  // Preserve history: if a different run is already current, archive it to
  // completedRunIds before assigning the new one rather than silently
  // dropping it (this path is reachable via the web SDK startRun route).
  const prev = session.currentRunId;
  const completedRunIds =
    prev && prev !== runId
      ? [...session.completedRunIds, prev]
      : [...session.completedRunIds];
  return {
    ...session,
    currentRunId: runId,
    completedRunIds,
    updatedAt: now(),
  };
}

export function completeSessionRun(session: Session): Session {
  const completedRunIds = session.currentRunId
    ? [...session.completedRunIds, session.currentRunId]
    : [...session.completedRunIds];
  return {
    ...session,
    currentRunId: null,
    completedRunIds,
    updatedAt: now(),
  };
}

export function updateHeartbeat(session: Session): Session {
  return {
    ...session,
    lastHeartbeatAt: now(),
    updatedAt: now(),
  };
}

export function updateResourceUsage(
  session: Session,
  usage: ResourceUsage,
): Session {
  return {
    ...session,
    resourceUsage: usage,
    updatedAt: now(),
  };
}

export function terminateSession(session: Session): Session {
  const timestamp = now();
  return {
    ...session,
    status: SessionStatus.Terminated,
    terminatedAt: timestamp,
    updatedAt: timestamp,
  };
}

// ─── Staleness ───────────────────────────────────────────────────────────────
//
// "Stale" = a session/run is still in a live status (active or running) but
// the hook hasn't checked in for a long time. Almost always means the
// underlying Claude Code session crashed, was force-quit, or pre-dates the
// SessionEnd hook being installed. These records inflate "Running Now"
// counts misleadingly until someone reaps them.
//
// The threshold is intentionally generous (30 minutes) — a real long-running
// agent should be heartbeating much more often than that, and we want to
// avoid false positives on the dashboard.

/** Default staleness threshold in milliseconds. 30 minutes. */
export const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Whether a session is "stale" — still active but hasn't heartbeat in a long
 * time. Terminated sessions are never stale (they finished cleanly).
 *
 * @param now reference timestamp in ms (defaults to Date.now()). Pass-through
 *   makes the function deterministic for tests and consistent across a batch
 *   of staleness checks evaluated in one loop.
 */
export function isStaleSession(
  session: Session,
  thresholdMs: number = STALE_THRESHOLD_MS,
  now: number = Date.now(),
): boolean {
  if (session.status !== SessionStatus.Active) return false;
  const last = new Date(session.lastHeartbeatAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last > thresholdMs;
}
