import { describe, it, expect, beforeEach } from "vitest";
import type { Job, Session, AgentEvent, ResourceLock, JobId, RunId, SessionId } from "../types.js";
import {
  JobStatus,
  SessionStatus,
  createJobId,
  createRunId,
  createSessionId,
  createAgentId,
  createLockId,
  LockType,
} from "../types.js";
import { EventBus } from "../events.js";
import { createSession, activateSession } from "../session.js";
import type { OrchestratorDb } from "../orchestrator.js";
import {
  submitAndQueueJob,
  dispatchNextJob,
  startJobExecution,
  completeJobExecution,
  failJobExecution,
  terminateSessionGracefully,
  cleanupStaleSessions,
  cleanupExpiredLocks,
} from "../orchestrator.js";

// ─── In-memory mock DB ──────────────────────────────────────────────────────

function createMockDb(): OrchestratorDb {
  const jobStore = new Map<string, Job>();
  const sessionStore = new Map<string, Session>();
  const eventStore: AgentEvent[] = [];
  const lockStore = new Map<string, ResourceLock>();

  return {
    insertJob(job: Job) {
      jobStore.set(job.id as string, job);
    },
    getJob(id: JobId) {
      return jobStore.get(id as string) ?? null;
    },
    updateJob(id: JobId, updates: Partial<Job>) {
      const existing = jobStore.get(id as string);
      if (existing) {
        jobStore.set(id as string, { ...existing, ...updates } as Job);
      }
    },
    getQueuedJobs(_limit?: number) {
      return Array.from(jobStore.values()).filter((j) => j.status === JobStatus.Queued);
    },
    countJobsByRepo(repo: string, statuses: string[]) {
      return Array.from(jobStore.values()).filter(
        (j) => j.environment.repo === repo && statuses.includes(j.status),
      ).length;
    },
    countJobsActive() {
      return Array.from(jobStore.values()).filter((j) =>
        ["queued", "dispatched", "running"].includes(j.status),
      ).length;
    },

    getSession(id: SessionId) {
      return sessionStore.get(id as string) ?? null;
    },
    updateSession(id: SessionId, updates: Partial<Session>) {
      const existing = sessionStore.get(id as string);
      if (existing) {
        sessionStore.set(id as string, { ...existing, ...updates } as Session);
      }
    },
    getActiveSessions() {
      return Array.from(sessionStore.values()).filter(
        (s) => s.status === SessionStatus.Active,
      );
    },
    getStaleSessions(thresholdIso: string) {
      return Array.from(sessionStore.values()).filter(
        (s) => s.status === SessionStatus.Active && s.lastHeartbeatAt < thresholdIso,
      );
    },

    insertEvent(event: AgentEvent) {
      eventStore.push(event);
    },

    insertLock(lock: ResourceLock) {
      lockStore.set(lock.id as string, lock);
    },
    updateLock(id: ResourceLock["id"], updates: Partial<ResourceLock>) {
      const existing = lockStore.get(id as string);
      if (existing) {
        lockStore.set(id as string, { ...existing, ...updates });
      }
    },
    getActiveLocks(resource: string) {
      return Array.from(lockStore.values()).filter(
        (l) => l.resource === resource && !l.released && new Date(l.expiresAt).getTime() > Date.now(),
      );
    },
    getActiveLocksForHolder(holderId: string) {
      return Array.from(lockStore.values()).filter(
        (l) => l.holderId === holderId && !l.released && new Date(l.expiresAt).getTime() > Date.now(),
      );
    },
    releaseLocksForHolder(holderId: string) {
      let count = 0;
      for (const [id, lock] of lockStore) {
        if (lock.holderId === holderId && !lock.released) {
          lockStore.set(id, { ...lock, released: true });
          count++;
        }
      }
      return count;
    },
    releaseExpiredLocks() {
      let count = 0;
      const now = Date.now();
      for (const [id, lock] of lockStore) {
        if (!lock.released && new Date(lock.expiresAt).getTime() <= now) {
          lockStore.set(id, { ...lock, released: true });
          count++;
        }
      }
      return count;
    },

    // Expose internals for test assertions
    _jobs: jobStore,
    _sessions: sessionStore,
    _events: eventStore,
    _locks: lockStore,
  } as OrchestratorDb & {
    _jobs: Map<string, Job>;
    _sessions: Map<string, Session>;
    _events: AgentEvent[];
    _locks: Map<string, ResourceLock>;
  };
}

// ─── Test helpers ───────────────────────────────────────────────────────────

const testGoal = {
  humanReadable: "Fix auth bug",
  structured: { type: "bugfix", description: "Fix auth bypass", parameters: {} },
};

const testEnvironment = {
  repo: "myorg/myapp",
  branch: "main",
  permissions: ["read", "write"] as readonly string[],
  sandbox: { enabled: false, isolationLevel: "none" },
};

function addActiveSession(db: ReturnType<typeof createMockDb>): Session {
  const session = activateSession(createSession("agent-1"));
  (db as any)._sessions.set(session.id as string, session);
  return session;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Orchestrator", () => {
  let db: ReturnType<typeof createMockDb>;
  let eventBus: EventBus;
  let publishedEvents: AgentEvent[];

  beforeEach(() => {
    db = createMockDb();
    eventBus = new EventBus();
    publishedEvents = [];
    eventBus.subscribe("*", (e) => publishedEvents.push(e));
  });

  describe("submitAndQueueJob", () => {
    it("creates and persists a job with Queued status", () => {
      const job = submitAndQueueJob(db, testGoal, testEnvironment, undefined, eventBus);

      expect(job.status).toBe(JobStatus.Queued);
      expect(db.getJob(job.id)).toBeTruthy();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]!.type).toBe("job.queued");
    });

    it("works without eventBus", () => {
      const job = submitAndQueueJob(db, testGoal, testEnvironment);
      expect(job.status).toBe(JobStatus.Queued);
      expect(db.getJob(job.id)).toBeTruthy();
    });
  });

  describe("dispatchNextJob", () => {
    it("dispatches a queued job to an available session", () => {
      const job = submitAndQueueJob(db, testGoal, testEnvironment, undefined, eventBus);
      const session = addActiveSession(db);

      const result = dispatchNextJob(db, eventBus);

      expect(result.dispatched).toBe(true);
      expect(result.job!.status).toBe(JobStatus.Dispatched);
      expect(result.session!.id).toBe(session.id);
      expect(result.reason).toBe("OK");

      // Check event was emitted
      const dispatchEvents = publishedEvents.filter((e) => e.type === "job.dispatched");
      expect(dispatchEvents).toHaveLength(1);
    });

    it("returns no-dispatch when queue is empty", () => {
      const result = dispatchNextJob(db, eventBus);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe("No queued jobs");
    });

    it("returns no-dispatch when no sessions available", () => {
      submitAndQueueJob(db, testGoal, testEnvironment, undefined, eventBus);

      const result = dispatchNextJob(db, eventBus);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe("No available sessions");
    });

    it("blocks dispatch when lock conflict exists", () => {
      submitAndQueueJob(db, testGoal, testEnvironment, undefined, eventBus);
      addActiveSession(db);

      // Insert a conflicting lock
      const lock: ResourceLock = {
        id: createLockId("existing_lock"),
        lockType: LockType.Repo,
        resource: "myorg/myapp",
        holderId: "other-session",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        released: false,
      };
      (db as any)._locks.set(lock.id as string, lock);

      const result = dispatchNextJob(db, eventBus);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("Conflict");
    });
  });

  describe("Full lifecycle: submit -> dispatch -> start -> complete", () => {
    it("completes the full job lifecycle", () => {
      // Submit
      const job = submitAndQueueJob(db, testGoal, testEnvironment, undefined, eventBus);
      const session = addActiveSession(db);

      // Dispatch
      const dispatchResult = dispatchNextJob(db, eventBus);
      expect(dispatchResult.dispatched).toBe(true);

      // Start
      const runId = createRunId("run_test_1");
      const startResult = startJobExecution(db, job.id, runId, eventBus);
      expect(startResult.success).toBe(true);
      expect(startResult.job.status).toBe(JobStatus.Running);

      // Verify session has the run assigned
      const sessionAfterStart = db.getSession(session.id);
      expect(sessionAfterStart!.currentRunId).toBe(runId);

      // Complete
      const completeResult = completeJobExecution(db, job.id, runId, eventBus);
      expect(completeResult.success).toBe(true);
      expect(completeResult.job.status).toBe(JobStatus.Completed);

      // Verify session run completed
      const sessionAfterComplete = db.getSession(session.id);
      expect(sessionAfterComplete!.currentRunId).toBeNull();
      expect(sessionAfterComplete!.completedRunIds).toContain(runId);

      // Verify events
      const eventTypes = publishedEvents.map((e) => e.type);
      expect(eventTypes).toContain("job.queued");
      expect(eventTypes).toContain("job.dispatched");
      expect(eventTypes).toContain("run.started");
      expect(eventTypes).toContain("run.completed");
      expect(eventTypes).toContain("job.completed");
    });
  });

  describe("failJobExecution", () => {
    it("retries a job that has attempts remaining", () => {
      const job = submitAndQueueJob(db, testGoal, testEnvironment, { maxAttempts: 3 }, eventBus);
      addActiveSession(db);

      // Dispatch and start
      dispatchNextJob(db, eventBus);
      const runId = createRunId("run_fail_1");
      startJobExecution(db, job.id, runId, eventBus);

      // Fail
      const failResult = failJobExecution(db, job.id, "Compilation error", eventBus);
      expect(failResult.success).toBe(true);
      expect(failResult.job.status).toBe(JobStatus.Queued);
      expect(failResult.reason).toContain("Retrying");

      // Verify the job was re-queued
      const updatedJob = db.getJob(job.id);
      expect(updatedJob!.status).toBe(JobStatus.Queued);
      expect(updatedJob!.attempt).toBe(1);
    });

    it("permanently fails a job that exceeds max attempts", () => {
      const job = submitAndQueueJob(
        db,
        testGoal,
        testEnvironment,
        { maxAttempts: 1 },
        eventBus,
      );
      addActiveSession(db);

      // Dispatch and start
      dispatchNextJob(db, eventBus);
      const runId = createRunId("run_permfail");
      startJobExecution(db, job.id, runId, eventBus);

      // Update attempt count to maxAttempts to trigger permanent failure
      db.updateJob(job.id, { attempt: 1 });

      const failResult = failJobExecution(db, job.id, "Still broken", eventBus);
      expect(failResult.success).toBe(true);
      expect(failResult.job.status).toBe(JobStatus.Failed);
      expect(failResult.reason).toBe("Permanently failed");
    });
  });

  describe("terminateSessionGracefully", () => {
    it("terminates session and releases locks", () => {
      const session = addActiveSession(db);

      // Add a lock held by this session
      const lock: ResourceLock = {
        id: createLockId("session_lock"),
        lockType: LockType.Repo,
        resource: "myorg/myapp",
        holderId: session.id as string,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        released: false,
      };
      (db as any)._locks.set(lock.id as string, lock);

      const result = terminateSessionGracefully(db, session.id, "Manual shutdown", eventBus);

      expect(result).toBeTruthy();
      expect(result!.status).toBe(SessionStatus.Terminated);

      // Verify lock was released
      const sessionLocks = db.getActiveLocksForHolder(session.id as string);
      expect(sessionLocks).toHaveLength(0);

      // Verify event
      const termEvents = publishedEvents.filter((e) => e.type === "session.terminated");
      expect(termEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("returns null for non-existent session", () => {
      const result = terminateSessionGracefully(
        db,
        createSessionId("nonexistent"),
        "test",
        eventBus,
      );
      expect(result).toBeNull();
    });
  });

  describe("cleanupStaleSessions", () => {
    it("terminates sessions with old heartbeats", () => {
      // Create a session with an old heartbeat
      const session = activateSession(createSession("agent-stale"));
      const staleSession = {
        ...session,
        lastHeartbeatAt: new Date(Date.now() - 120000).toISOString(),
      } as Session;
      (db as any)._sessions.set(staleSession.id as string, staleSession);

      // Create a fresh session that should NOT be cleaned up
      const freshSession = addActiveSession(db);

      const terminated = cleanupStaleSessions(db, 60000, eventBus);

      expect(terminated).toHaveLength(1);
      expect(terminated[0]!.id).toBe(staleSession.id);

      // Fresh session should still be active
      const fresh = db.getSession(freshSession.id);
      expect(fresh!.status).toBe(SessionStatus.Active);
    });
  });

  describe("cleanupExpiredLocks", () => {
    it("releases expired locks and emits event", () => {
      // Add an expired lock
      const expiredLock: ResourceLock = {
        id: createLockId("expired_lock"),
        lockType: LockType.Repo,
        resource: "myorg/myapp",
        holderId: "old-session",
        acquiredAt: new Date(Date.now() - 120000).toISOString(),
        expiresAt: new Date(Date.now() - 60000).toISOString(),
        released: false,
      };
      (db as any)._locks.set(expiredLock.id as string, expiredLock);

      const count = cleanupExpiredLocks(db, eventBus);
      expect(count).toBe(1);
    });

    it("does nothing when no expired locks", () => {
      const count = cleanupExpiredLocks(db, eventBus);
      expect(count).toBe(0);
    });
  });
});
