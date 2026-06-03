import type { Job, Session, AgentEvent, ResourceLock, JobId, RunId, SessionId, Goal, Environment } from "./types.js";
import { JobStatus, SessionStatus, EventCategory, LockType, createRunId } from "./types.js";
import { createJob, dispatchJob, startJobRun, completeJob, failJob, retryJob } from "./job.js";
import type { CreateJobOptions } from "./job.js";
import { assignRun, completeSessionRun, terminateSession } from "./session.js";
import { createEvent, EventBus } from "./events.js";
import { createLock, releaseLock, checkConflicts, isLockExpired } from "./coordination.js";
import { selectNextJob, matchSession, evaluateDispatch } from "./dispatcher.js";

// Re-export EventBus for convenience
export { EventBus } from "./events.js";

// ─── Result types ───────────────────────────────────────────────────────────

export interface DispatchResult {
  readonly dispatched: boolean;
  readonly job: Job | null;
  readonly session: Session | null;
  readonly reason: string;
}

export interface ExecutionResult {
  readonly success: boolean;
  readonly job: Job;
  readonly reason: string;
}

// ─── DB interface (duck-typed to avoid circular dependency) ─────────────────
// The orchestrator accepts any object that provides the repository functions it
// needs.  In practice callers pass the AgentOpsDb from @agentops/db along with
// the repository helpers.  We define a narrow interface here so the core
// package does not depend on the db package.

export interface OrchestratorDb {
  insertJob(job: Job): void;
  getJob(id: JobId): Job | null;
  updateJob(id: JobId, updates: Partial<Job>): void;
  getQueuedJobs(limit?: number): Job[];
  countJobsByRepo(repo: string, statuses: string[]): number;
  countJobsActive(): number;

  getSession(id: SessionId): Session | null;
  updateSession(id: SessionId, updates: Partial<Session>): void;
  getActiveSessions(): Session[];
  getStaleSessions(thresholdIso: string): Session[];

  insertEvent(event: AgentEvent): void;

  insertLock(lock: ResourceLock): void;
  updateLock(id: ResourceLock["id"], updates: Partial<ResourceLock>): void;
  getActiveLocks(resource: string): ResourceLock[];
  getActiveLocksForHolder(holderId: string): ResourceLock[];
  releaseLocksForHolder(holderId: string): number;
  releaseExpiredLocks(): number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

let runCounter = 0;
function generateRunId(): RunId {
  runCounter++;
  return createRunId(`run_${Date.now()}_${runCounter}`);
}

function persistAndPublish(db: OrchestratorDb, eventBus: EventBus, event: AgentEvent): void {
  db.insertEvent(event);
  eventBus.publish(event);
}

// ─── Orchestrator functions ─────────────────────────────────────────────────

/**
 * Creates a job, persists it, emits job.queued event, returns the job.
 */
export function submitAndQueueJob(
  db: OrchestratorDb,
  goal: Goal,
  environment: Environment,
  options?: CreateJobOptions,
  eventBus?: EventBus,
): Job {
  const job = createJob(goal, environment, options);
  db.insertJob(job);

  if (eventBus) {
    const event = createEvent(EventCategory.Job, "job.queued", job.id as string, {
      jobId: job.id,
      priority: job.priority,
      repo: job.environment.repo,
    });
    persistAndPublish(db, eventBus, event);
  }

  return job;
}

/**
 * Pulls next queued job, checks active sessions, checks locks, acquires repo
 * lock, dispatches to a session, emits job.dispatched event.
 */
export function dispatchNextJob(
  db: OrchestratorDb,
  eventBus: EventBus,
): DispatchResult {
  // 1. Get queued jobs
  const queuedJobs = db.getQueuedJobs(50);
  const nextJob = selectNextJob(queuedJobs);

  if (!nextJob) {
    return { dispatched: false, job: null, session: null, reason: "No queued jobs" };
  }

  // 2. Check concurrency limits
  const activeSessions = db.getActiveSessions();
  const activeJobsByRepo = db.countJobsByRepo(nextJob.environment.repo, ["dispatched", "running"]);
  const activeJobsTotal = db.countJobsActive();

  const decision = evaluateDispatch(
    nextJob,
    activeSessions,
    activeJobsByRepo,
    activeJobsTotal,
    { concurrencyLimits: nextJob.concurrencyLimits },
  );

  if (!decision.canDispatch) {
    return { dispatched: false, job: nextJob, session: null, reason: decision.reason };
  }

  // 3. Check lock conflicts
  const activeLocks = db.getActiveLocks(nextJob.environment.repo);
  const conflict = checkConflicts(nextJob.environment.repo, LockType.Repo, activeLocks);

  if (conflict.hasConflict) {
    return { dispatched: false, job: nextJob, session: null, reason: conflict.message };
  }

  // 4. Find an available session
  const session = matchSession(nextJob, activeSessions);
  if (!session) {
    return { dispatched: false, job: nextJob, session: null, reason: "No available sessions" };
  }

  // 5. Acquire repo lock
  const lock = createLock(LockType.Repo, nextJob.environment.repo, session.id as string, 30 * 60 * 1000);
  db.insertLock(lock);

  // 6. Dispatch job to session
  const dispatched = dispatchJob(nextJob, session.id);
  db.updateJob(dispatched.id, {
    status: dispatched.status,
    sessionId: dispatched.sessionId,
    dispatchedAt: dispatched.dispatchedAt,
    updatedAt: dispatched.updatedAt,
  });

  // 7. Emit event
  const event = createEvent(EventCategory.Job, "job.dispatched", dispatched.id as string, {
    jobId: dispatched.id,
    sessionId: session.id,
    repo: dispatched.environment.repo,
  });
  persistAndPublish(db, eventBus, event);

  return { dispatched: true, job: dispatched, session, reason: "OK" };
}

/**
 * Transitions job to Running, assigns run to session, emits run.started event.
 */
export function startJobExecution(
  db: OrchestratorDb,
  jobId: JobId,
  runId: RunId,
  eventBus: EventBus,
): ExecutionResult {
  const job = db.getJob(jobId);
  if (!job) {
    return { success: false, job: null as unknown as Job, reason: "Job not found" };
  }

  // Transition job to running
  const running = startJobRun(job, runId);
  db.updateJob(running.id, {
    status: running.status,
    runIds: running.runIds,
    updatedAt: running.updatedAt,
  });

  // Assign run to session
  if (job.sessionId) {
    const session = db.getSession(job.sessionId);
    if (session) {
      const assigned = assignRun(session, runId);
      db.updateSession(assigned.id, {
        currentRunId: assigned.currentRunId,
        // Persist the archived prior run too — assignRun moves any existing
        // currentRunId into completedRunIds, which is otherwise lost here.
        completedRunIds: assigned.completedRunIds,
        updatedAt: assigned.updatedAt,
      });
    }
  }

  // Emit event
  const event = createEvent(EventCategory.Run, "run.started", jobId as string, {
    jobId,
    runId,
    sessionId: job.sessionId,
  });
  persistAndPublish(db, eventBus, event);

  return { success: true, job: running, reason: "OK" };
}

/**
 * Completes the job, completes the session run, releases locks, emits
 * job.completed + run.completed events.
 */
export function completeJobExecution(
  db: OrchestratorDb,
  jobId: JobId,
  runId: RunId,
  eventBus: EventBus,
): ExecutionResult {
  const job = db.getJob(jobId);
  if (!job) {
    return { success: false, job: null as unknown as Job, reason: "Job not found" };
  }

  // Complete the job
  const completed = completeJob(job);
  db.updateJob(completed.id, {
    status: completed.status,
    completedAt: completed.completedAt,
    updatedAt: completed.updatedAt,
  });

  // Complete session run
  if (job.sessionId) {
    const session = db.getSession(job.sessionId);
    if (session) {
      const completedSession = completeSessionRun(session);
      db.updateSession(completedSession.id, {
        currentRunId: completedSession.currentRunId,
        completedRunIds: completedSession.completedRunIds,
        updatedAt: completedSession.updatedAt,
      });
    }

    // Release locks held by session
    db.releaseLocksForHolder(job.sessionId as string);
  }

  // Emit run.completed
  const runEvent = createEvent(EventCategory.Run, "run.completed", jobId as string, {
    jobId,
    runId,
  });
  persistAndPublish(db, eventBus, runEvent);

  // Emit job.completed
  const jobEvent = createEvent(EventCategory.Job, "job.completed", jobId as string, {
    jobId,
    repo: completed.environment.repo,
  });
  persistAndPublish(db, eventBus, jobEvent);

  return { success: true, job: completed, reason: "OK" };
}

/**
 * Fails the job, checks retry policy, either retries (re-queues) or
 * permanently fails, releases locks, emits job.failed event.
 */
export function failJobExecution(
  db: OrchestratorDb,
  jobId: JobId,
  reason: string,
  eventBus: EventBus,
): ExecutionResult {
  const job = db.getJob(jobId);
  if (!job) {
    return { success: false, job: null as unknown as Job, reason: "Job not found" };
  }

  // Release locks held by session
  if (job.sessionId) {
    db.releaseLocksForHolder(job.sessionId as string);

    // Complete session run so it becomes available
    const session = db.getSession(job.sessionId);
    if (session) {
      const completedSession = completeSessionRun(session);
      db.updateSession(completedSession.id, {
        currentRunId: completedSession.currentRunId,
        completedRunIds: completedSession.completedRunIds,
        updatedAt: completedSession.updatedAt,
      });
    }
  }

  // Check retry policy
  const retried = retryJob(job);

  if (retried.status === JobStatus.Queued) {
    // Retry: re-queue
    db.updateJob(retried.id, {
      status: retried.status,
      attempt: retried.attempt,
      sessionId: retried.sessionId,
      dispatchedAt: retried.dispatchedAt,
      updatedAt: retried.updatedAt,
    });

    const event = createEvent(EventCategory.Job, "job.failed", jobId as string, {
      jobId,
      reason,
      retrying: true,
      attempt: retried.attempt,
    });
    persistAndPublish(db, eventBus, event);

    return { success: true, job: retried, reason: `Retrying (attempt ${retried.attempt})` };
  }

  // Permanent failure
  const failed = failJob(job, reason);
  db.updateJob(failed.id, {
    status: failed.status,
    updatedAt: failed.updatedAt,
  });

  const event = createEvent(EventCategory.Job, "job.failed", jobId as string, {
    jobId,
    reason,
    retrying: false,
    permanent: true,
  });
  persistAndPublish(db, eventBus, event);

  return { success: true, job: failed, reason: "Permanently failed" };
}

/**
 * Terminates session, releases all locks held by session, emits
 * session.terminated event.
 */
export function terminateSessionGracefully(
  db: OrchestratorDb,
  sessionId: SessionId,
  reason: string,
  eventBus: EventBus,
): Session | null {
  const session = db.getSession(sessionId);
  if (!session) return null;

  const terminated = terminateSession(session);
  db.updateSession(terminated.id, {
    status: terminated.status,
    terminatedAt: terminated.terminatedAt,
    updatedAt: terminated.updatedAt,
  });

  // Release all locks held by this session
  db.releaseLocksForHolder(sessionId as string);

  // Emit event
  const event = createEvent(EventCategory.Session, "session.terminated", sessionId as string, {
    sessionId,
    reason,
  });
  persistAndPublish(db, eventBus, event);

  return terminated;
}

/**
 * Finds sessions with old heartbeats, terminates them, releases their locks.
 */
export function cleanupStaleSessions(
  db: OrchestratorDb,
  thresholdMs: number,
  eventBus: EventBus,
): Session[] {
  const thresholdIso = new Date(Date.now() - thresholdMs).toISOString();
  const staleSessions = db.getStaleSessions(thresholdIso);

  const terminated: Session[] = [];
  for (const session of staleSessions) {
    const result = terminateSessionGracefully(db, session.id, "Stale heartbeat", eventBus);
    if (result) {
      terminated.push(result);
    }
  }

  return terminated;
}

/**
 * Releases expired locks, emits events for each.
 */
export function cleanupExpiredLocks(
  db: OrchestratorDb,
  eventBus: EventBus,
): number {
  const count = db.releaseExpiredLocks();

  if (count > 0) {
    const event = createEvent(EventCategory.Session, "session.terminated", "system", {
      type: "lock.cleanup",
      releasedCount: count,
    });
    persistAndPublish(db, eventBus, event);
  }

  return count;
}
