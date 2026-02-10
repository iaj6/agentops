import { describe, it, expect } from "vitest";
import {
  createJobId,
  createSessionId,
  createEventId,
  createLockId,
  createAgentId,
  createRunId,
  JobStatus,
  JobPriority,
  SessionStatus,
  EventCategory,
  LockType,
} from "../types.js";
import type { Job, Session, AgentEvent, ResourceLock } from "../types.js";

describe("Orchestration branded ID helpers", () => {
  it("createJobId returns a branded string", () => {
    const id = createJobId("job_123");
    expect(id).toBe("job_123");
    expect(typeof id).toBe("string");
  });

  it("createSessionId returns a branded string", () => {
    const id = createSessionId("session_abc");
    expect(id).toBe("session_abc");
    expect(typeof id).toBe("string");
  });

  it("createEventId returns a branded string", () => {
    const id = createEventId("evt_456");
    expect(id).toBe("evt_456");
    expect(typeof id).toBe("string");
  });

  it("createLockId returns a branded string", () => {
    const id = createLockId("lock_789");
    expect(id).toBe("lock_789");
    expect(typeof id).toBe("string");
  });
});

describe("JobStatus enum", () => {
  it("has expected values", () => {
    expect(JobStatus.Queued).toBe("queued");
    expect(JobStatus.Dispatched).toBe("dispatched");
    expect(JobStatus.Running).toBe("running");
    expect(JobStatus.Completed).toBe("completed");
    expect(JobStatus.Failed).toBe("failed");
    expect(JobStatus.Cancelled).toBe("cancelled");
  });
});

describe("JobPriority enum", () => {
  it("has expected values", () => {
    expect(JobPriority.Critical).toBe("critical");
    expect(JobPriority.High).toBe("high");
    expect(JobPriority.Normal).toBe("normal");
    expect(JobPriority.Low).toBe("low");
  });
});

describe("SessionStatus enum", () => {
  it("has expected values", () => {
    expect(SessionStatus.Provisioning).toBe("provisioning");
    expect(SessionStatus.Active).toBe("active");
    expect(SessionStatus.Paused).toBe("paused");
    expect(SessionStatus.Terminated).toBe("terminated");
  });
});

describe("EventCategory enum", () => {
  it("has expected values", () => {
    expect(EventCategory.Job).toBe("job");
    expect(EventCategory.Run).toBe("run");
    expect(EventCategory.Session).toBe("session");
    expect(EventCategory.Policy).toBe("policy");
    expect(EventCategory.Cost).toBe("cost");
    expect(EventCategory.Action).toBe("action");
  });
});

describe("LockType enum", () => {
  it("has expected values", () => {
    expect(LockType.Repo).toBe("repo");
    expect(LockType.Path).toBe("path");
    expect(LockType.Branch).toBe("branch");
  });
});

describe("Job interface (structural)", () => {
  it("can be constructed with all required fields", () => {
    const job: Job = {
      id: createJobId("job_1"),
      status: JobStatus.Queued,
      priority: JobPriority.Normal,
      goal: {
        humanReadable: "Fix the bug",
        structured: { type: "task", description: "Fix the bug", parameters: {} },
      },
      environment: {
        repo: "test/repo",
        branch: "main",
        permissions: ["read", "write"],
        sandbox: { enabled: true, isolationLevel: "container" },
      },
      retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
      concurrencyLimits: { perRepo: 5, perOrg: 20, global: 50 },
      runIds: [],
      sessionId: null,
      attempt: 0,
      maxAttempts: 3,
      queuedAt: "2025-01-01T00:00:00.000Z",
      dispatchedAt: null,
      completedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    expect(job.id).toBe("job_1");
    expect(job.status).toBe(JobStatus.Queued);
    expect(job.priority).toBe(JobPriority.Normal);
    expect(job.runIds).toHaveLength(0);
    expect(job.sessionId).toBeNull();
  });
});

describe("Session interface (structural)", () => {
  it("can be constructed with all required fields", () => {
    const session: Session = {
      id: createSessionId("session_1"),
      status: SessionStatus.Active,
      agentId: createAgentId("agent_1"),
      currentRunId: createRunId("run_1"),
      completedRunIds: [],
      resourceUsage: {
        memoryMb: 256,
        cpuPercent: 15,
        tokensBudgetRemaining: 100000,
        costBudgetRemaining: 5.0,
      },
      metadata: { runtime: "claude-code" },
      startedAt: "2025-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2025-01-01T00:05:00.000Z",
      terminatedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:05:00.000Z",
    };

    expect(session.id).toBe("session_1");
    expect(session.status).toBe(SessionStatus.Active);
    expect(session.currentRunId).toBe("run_1");
    expect(session.resourceUsage.memoryMb).toBe(256);
  });
});

describe("AgentEvent interface (structural)", () => {
  it("can be constructed with all required fields", () => {
    const event: AgentEvent = {
      id: createEventId("evt_1"),
      category: EventCategory.Job,
      type: "job.queued",
      payload: { jobId: "job_1", priority: "normal" },
      sourceId: "job_1",
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    expect(event.id).toBe("evt_1");
    expect(event.category).toBe(EventCategory.Job);
    expect(event.type).toBe("job.queued");
    expect(event.payload).toHaveProperty("jobId");
  });
});

describe("ResourceLock interface (structural)", () => {
  it("can be constructed with all required fields", () => {
    const lock: ResourceLock = {
      id: createLockId("lock_1"),
      lockType: LockType.Repo,
      resource: "acme/backend",
      holderId: "job_1",
      acquiredAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-01-01T01:00:00.000Z",
      released: false,
    };

    expect(lock.id).toBe("lock_1");
    expect(lock.lockType).toBe(LockType.Repo);
    expect(lock.resource).toBe("acme/backend");
    expect(lock.released).toBe(false);
  });
});
