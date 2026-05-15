import type { Run, Action, Artifact, Evaluation } from "./types.js";
import { RunStatus, DecisionType, createRunId, createDecisionId } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

let counter = 0;
function generateId(): string {
  counter++;
  return `run_${Date.now()}_${counter}`;
}

export function createRun(goal: Run["goal"], environment: Run["environment"]): Run {
  const timestamp = now();
  return {
    id: createRunId(generateId()),
    status: RunStatus.Pending,
    goal,
    agents: [],
    environment,
    actions: [],
    artifacts: [],
    metrics: {
      tokenUsage: { input: 0, output: 0, total: 0 },
      wallTimeMs: 0,
      costUsd: 0,
      flakeRate: 0,
    },
    evaluations: [],
    decisions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function startRun(run: Run): Run {
  return {
    ...run,
    status: RunStatus.Running,
    updatedAt: now(),
  };
}

export function addAction(run: Run, action: Action): Run {
  return {
    ...run,
    actions: [...run.actions, action],
    updatedAt: now(),
  };
}

export function addArtifact(run: Run, artifact: Artifact): Run {
  return {
    ...run,
    artifacts: [...run.artifacts, artifact],
    updatedAt: now(),
  };
}

export function completeRun(run: Run, evaluation: Evaluation): Run {
  return {
    ...run,
    status: RunStatus.Completed,
    evaluations: [...run.evaluations, evaluation],
    updatedAt: now(),
  };
}

// ─── Staleness ───────────────────────────────────────────────────────────────
//
// Runs don't carry a heartbeat, but they do carry `updatedAt` which is
// touched on every action recorded by the hook. A run that's been "running"
// without any updates for a long time is almost certainly a crashed/
// force-quit session — the hook never got to call finalizeRun.
//
// Threshold matches sessions (30 minutes by default) so the dashboard's
// staleness story is consistent.

/** Default staleness threshold in milliseconds. 30 minutes. */
export const RUN_STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Whether a run is "stale" — still in `running` status but hasn't been
 * updated in a long time. Completed / failed / blocked runs are never stale.
 */
export function isStaleRun(
  run: Run,
  thresholdMs: number = RUN_STALE_THRESHOLD_MS,
  now: number = Date.now(),
): boolean {
  if (run.status !== RunStatus.Running) return false;
  const last = new Date(run.updatedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last > thresholdMs;
}

export function failRun(run: Run, reason: string): Run {
  return {
    ...run,
    status: RunStatus.Failed,
    decisions: [
      ...run.decisions,
      {
        id: createDecisionId(`decision_${Date.now()}`),
        type: DecisionType.Block,
        actor: "system",
        reason,
        timestamp: now(),
      },
    ],
    updatedAt: now(),
  };
}

export function blockRun(run: Run, actor: string, reason: string): Run {
  return {
    ...run,
    status: RunStatus.Blocked,
    decisions: [
      ...run.decisions,
      {
        id: createDecisionId(`decision_${Date.now()}`),
        type: DecisionType.Block,
        actor,
        reason,
        timestamp: now(),
      },
    ],
    updatedAt: now(),
  };
}

export function cancelRun(run: Run): Run {
  return {
    ...run,
    status: RunStatus.Cancelled,
    updatedAt: now(),
  };
}
