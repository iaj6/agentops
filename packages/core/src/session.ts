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
  return {
    ...session,
    currentRunId: runId,
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

export function pauseSession(session: Session): Session {
  return {
    ...session,
    status: SessionStatus.Paused,
    updatedAt: now(),
  };
}

export function resumeSession(session: Session): Session {
  return {
    ...session,
    status: SessionStatus.Active,
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
