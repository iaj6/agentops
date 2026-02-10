import type { Job, Session, ConcurrencyLimits } from "./types.js";
import { JobPriority, SessionStatus } from "./types.js";

export interface DispatchConfig {
  concurrencyLimits: ConcurrencyLimits;
}

export interface DispatchDecision {
  canDispatch: boolean;
  reason: string;
}

const PRIORITY_ORDER: Record<string, number> = {
  [JobPriority.Critical]: 4,
  [JobPriority.High]: 3,
  [JobPriority.Normal]: 2,
  [JobPriority.Low]: 1,
};

export function evaluateDispatch(
  job: Job,
  _activeSessions: Session[],
  activeJobsByRepo: number,
  activeJobsTotal: number,
  config: DispatchConfig,
): DispatchDecision {
  if (activeJobsTotal >= config.concurrencyLimits.global) {
    return { canDispatch: false, reason: "Global concurrency limit reached" };
  }
  if (activeJobsByRepo >= config.concurrencyLimits.perRepo) {
    return { canDispatch: false, reason: "Per-repo concurrency limit reached" };
  }
  return { canDispatch: true, reason: "OK" };
}

export function selectNextJob(queue: Job[]): Job | null {
  if (queue.length === 0) return null;
  const sorted = [...queue].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 0;
    const pb = PRIORITY_ORDER[b.priority] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.queuedAt.localeCompare(b.queuedAt);
  });
  return sorted[0]!;
}

export function matchSession(
  _job: Job,
  sessions: Session[],
): Session | null {
  const active = sessions.filter((s) => s.status === SessionStatus.Active && s.currentRunId === null);
  if (active.length === 0) return null;
  return active[0]!;
}
