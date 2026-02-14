import { describe, it, expect } from "vitest";
import { evaluateDispatch, selectNextJob, matchSession } from "../dispatcher.js";
import {
  JobStatus,
  JobPriority,
  SessionStatus,
  createJobId,
  createSessionId,
  createAgentId,
  createRunId,
} from "../types.js";
import type { Job, Session, ConcurrencyLimits } from "../types.js";

const defaultLimits: ConcurrencyLimits = {
  perRepo: 5,
  perOrg: 10,
  global: 50,
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: createJobId("job_1"),
    status: JobStatus.Queued,
    priority: JobPriority.Normal,
    goal: {
      humanReadable: "Test",
      structured: { type: "task", description: "Test", parameters: {} },
    },
    environment: {
      repo: "test/repo",
      branch: "main",
      permissions: [],
      sandbox: { enabled: false, isolationLevel: "none" },
    },
    retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
    concurrencyLimits: defaultLimits,
    runIds: [],
    sessionId: null,
    attempt: 0,
    maxAttempts: 3,
    queuedAt: "2025-01-01T00:00:00.000Z",
    dispatchedAt: null,
    completedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: createSessionId("session_1"),
    status: SessionStatus.Active,
    agentId: createAgentId("agent_1"),
    currentRunId: null,
    completedRunIds: [],
    resourceUsage: {
      memoryMb: 256,
      cpuPercent: 10,
      tokensBudgetRemaining: 100000,
      costBudgetRemaining: 50,
    },
    metadata: {},
    startedAt: "2025-01-01T00:00:00.000Z",
    lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
    terminatedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluateDispatch", () => {
  it("allows dispatch when under limits", () => {
    const job = makeJob();
    const result = evaluateDispatch(job, [], 2, 10, { concurrencyLimits: defaultLimits });

    expect(result.canDispatch).toBe(true);
    expect(result.reason).toBe("OK");
  });

  it("blocks when global limit reached", () => {
    const job = makeJob();
    const result = evaluateDispatch(job, [], 2, 50, { concurrencyLimits: defaultLimits });

    expect(result.canDispatch).toBe(false);
    expect(result.reason).toContain("Global");
  });

  it("blocks when per-repo limit reached", () => {
    const job = makeJob();
    const result = evaluateDispatch(job, [], 5, 10, { concurrencyLimits: defaultLimits });

    expect(result.canDispatch).toBe(false);
    expect(result.reason).toContain("repo");
  });
});

describe("selectNextJob", () => {
  it("returns null for empty queue", () => {
    expect(selectNextJob([])).toBeNull();
  });

  it("selects highest priority job first", () => {
    const low = makeJob({ id: createJobId("job_low"), priority: JobPriority.Low });
    const critical = makeJob({ id: createJobId("job_critical"), priority: JobPriority.Critical });
    const normal = makeJob({ id: createJobId("job_normal"), priority: JobPriority.Normal });

    const selected = selectNextJob([low, critical, normal]);
    expect(selected!.id).toBe("job_critical");
  });

  it("uses queuedAt as tiebreaker for same priority", () => {
    const earlier = makeJob({
      id: createJobId("job_early"),
      priority: JobPriority.Normal,
      queuedAt: "2025-01-01T00:00:00.000Z",
    });
    const later = makeJob({
      id: createJobId("job_late"),
      priority: JobPriority.Normal,
      queuedAt: "2025-01-02T00:00:00.000Z",
    });

    const selected = selectNextJob([later, earlier]);
    expect(selected!.id).toBe("job_early");
  });
});

describe("matchSession", () => {
  it("returns null when no active sessions", () => {
    const job = makeJob();
    expect(matchSession(job, [])).toBeNull();
  });

  it("returns an active session with no current run", () => {
    const job = makeJob();
    const session = makeSession({ id: createSessionId("session_1"), currentRunId: null });
    const result = matchSession(job, [session]);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("session_1");
  });

  it("skips sessions that already have a current run", () => {
    const job = makeJob();
    const busy = makeSession({
      id: createSessionId("session_busy"),
      currentRunId: createRunId("run_1"),
    });
    const free = makeSession({
      id: createSessionId("session_free"),
      currentRunId: null,
    });

    const result = matchSession(job, [busy, free]);
    expect(result!.id).toBe("session_free");
  });

  it("skips non-active sessions", () => {
    const job = makeJob();
    const provisioning = makeSession({
      id: createSessionId("session_provisioning"),
      status: SessionStatus.Provisioning,
    });

    expect(matchSession(job, [provisioning])).toBeNull();
  });
});
