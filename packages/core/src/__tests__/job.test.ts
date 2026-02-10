import { describe, it, expect } from "vitest";
import {
  createJob,
  dispatchJob,
  startJobRun,
  completeJob,
  failJob,
  cancelJob,
  retryJob,
} from "../job.js";
import {
  JobStatus,
  JobPriority,
  createSessionId,
  createRunId,
} from "../types.js";
import type { Job } from "../types.js";

const testGoal: Job["goal"] = {
  humanReadable: "Fix bug in auth module",
  structured: { type: "bugfix", description: "Fix bug in auth module", parameters: {} },
};

const testEnv: Job["environment"] = {
  repo: "acme/backend",
  branch: "fix/auth-bug",
  permissions: ["read", "write"],
  sandbox: { enabled: true, isolationLevel: "container" },
};

describe("createJob", () => {
  it("produces a valid initial Job with Queued status", () => {
    const job = createJob(testGoal, testEnv);

    expect(job.id).toBeTruthy();
    expect(typeof job.id).toBe("string");
    expect(job.status).toBe(JobStatus.Queued);
    expect(job.priority).toBe(JobPriority.Normal);
    expect(job.goal).toEqual(testGoal);
    expect(job.environment).toEqual(testEnv);
    expect(job.runIds).toEqual([]);
    expect(job.sessionId).toBeNull();
    expect(job.attempt).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.queuedAt).toBeTruthy();
    expect(job.dispatchedAt).toBeNull();
    expect(job.completedAt).toBeNull();
    expect(job.createdAt).toBeTruthy();
    expect(job.updatedAt).toBeTruthy();
  });

  it("accepts custom priority and options", () => {
    const job = createJob(testGoal, testEnv, {
      priority: JobPriority.Critical,
      maxAttempts: 5,
    });

    expect(job.priority).toBe(JobPriority.Critical);
    expect(job.maxAttempts).toBe(5);
  });

  it("generates unique IDs for different jobs", () => {
    const job1 = createJob(testGoal, testEnv);
    const job2 = createJob(testGoal, testEnv);
    expect(job1.id).not.toBe(job2.id);
  });
});

describe("dispatchJob", () => {
  it("sets status to Dispatched with sessionId", () => {
    const job = createJob(testGoal, testEnv);
    const sessionId = createSessionId("session_1");
    const dispatched = dispatchJob(job, sessionId);

    expect(dispatched.status).toBe(JobStatus.Dispatched);
    expect(dispatched.sessionId).toBe(sessionId);
    expect(dispatched.dispatchedAt).toBeTruthy();
    expect(dispatched.id).toBe(job.id);
  });
});

describe("startJobRun", () => {
  it("sets status to Running and appends runId", () => {
    const job = createJob(testGoal, testEnv);
    const runId = createRunId("run_1");
    const running = startJobRun(job, runId);

    expect(running.status).toBe(JobStatus.Running);
    expect(running.runIds).toHaveLength(1);
    expect(running.runIds[0]).toBe(runId);
    // Original is unchanged (immutable)
    expect(job.runIds).toHaveLength(0);
  });
});

describe("completeJob", () => {
  it("sets status to Completed with completedAt", () => {
    const job = createJob(testGoal, testEnv);
    const completed = completeJob(job);

    expect(completed.status).toBe(JobStatus.Completed);
    expect(completed.completedAt).toBeTruthy();
  });
});

describe("failJob", () => {
  it("sets status to Failed", () => {
    const job = createJob(testGoal, testEnv);
    const failed = failJob(job, "Build failed");

    expect(failed.status).toBe(JobStatus.Failed);
  });
});

describe("cancelJob", () => {
  it("sets status to Cancelled", () => {
    const job = createJob(testGoal, testEnv);
    const cancelled = cancelJob(job);

    expect(cancelled.status).toBe(JobStatus.Cancelled);
  });
});

describe("retryJob", () => {
  it("increments attempt and resets to Queued when under maxAttempts", () => {
    const job = createJob(testGoal, testEnv, { maxAttempts: 3 });
    const retried = retryJob(job);

    expect(retried.status).toBe(JobStatus.Queued);
    expect(retried.attempt).toBe(1);
    expect(retried.sessionId).toBeNull();
    expect(retried.dispatchedAt).toBeNull();
  });

  it("sets status to Failed when maxAttempts reached", () => {
    let job = createJob(testGoal, testEnv, { maxAttempts: 2 });
    job = { ...job, attempt: 2 };
    const retried = retryJob(job);

    expect(retried.status).toBe(JobStatus.Failed);
    expect(retried.attempt).toBe(2);
  });
});
