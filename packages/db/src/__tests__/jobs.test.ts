import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertJob, getJob, listJobs, updateJob, countJobsByRepo, countJobsActive, getQueuedJobs } from "../jobs.js";
import type { AgentOpsDb } from "../connection.js";
import type { Job } from "@agentops/core";
import { createJobId, JobStatus, JobPriority } from "@agentops/core";

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id: createJobId(id),
    status: JobStatus.Queued,
    priority: JobPriority.Normal,
    goal: {
      humanReadable: "Test goal",
      structured: { type: "task", description: "Test goal", parameters: {} },
    },
    environment: {
      repo: "test/repo",
      branch: "main",
      permissions: [],
      sandbox: { enabled: false, isolationLevel: "none" },
    },
    retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
    concurrencyLimits: { perRepo: 5, perOrg: 10, global: 50 },
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

describe("Jobs repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertJob and getJob", () => {
    it("inserts and retrieves a job", () => {
      const job = makeJob("job_1");
      insertJob(db, job);

      const retrieved = getJob(db, createJobId("job_1"));
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("job_1");
      expect(retrieved!.status).toBe(JobStatus.Queued);
      expect(retrieved!.priority).toBe(JobPriority.Normal);
      expect(retrieved!.goal.humanReadable).toBe("Test goal");
      expect(retrieved!.environment.repo).toBe("test/repo");
    });

    it("returns null for non-existent job", () => {
      const result = getJob(db, createJobId("nonexistent"));
      expect(result).toBeNull();
    });
  });

  describe("listJobs", () => {
    it("lists all jobs ordered by createdAt descending", () => {
      insertJob(db, makeJob("job_1", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertJob(db, makeJob("job_2", { createdAt: "2025-01-02T00:00:00.000Z" }));
      insertJob(db, makeJob("job_3", { createdAt: "2025-01-03T00:00:00.000Z" }));

      const results = listJobs(db);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("job_3");
      expect(results[1]!.id).toBe("job_2");
      expect(results[2]!.id).toBe("job_1");
    });

    it("filters by status", () => {
      insertJob(db, makeJob("job_1", { status: JobStatus.Queued }));
      insertJob(db, makeJob("job_2", { status: JobStatus.Running }));
      insertJob(db, makeJob("job_3", { status: JobStatus.Queued }));

      const results = listJobs(db, { status: "queued" });
      expect(results).toHaveLength(2);
      expect(results.every((j) => j.status === JobStatus.Queued)).toBe(true);
    });

    it("filters by repo", () => {
      insertJob(db, makeJob("job_1", {
        environment: { repo: "org/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertJob(db, makeJob("job_2", {
        environment: { repo: "org/lib", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const results = listJobs(db, { repo: "org/app" });
      expect(results).toHaveLength(1);
      expect(results[0]!.environment.repo).toBe("org/app");
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertJob(db, makeJob(`job_${i}`, {
          createdAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        }));
      }

      const results = listJobs(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });
  });

  describe("updateJob", () => {
    it("updates job status", () => {
      insertJob(db, makeJob("job_1", { status: JobStatus.Queued }));

      updateJob(db, createJobId("job_1"), {
        status: JobStatus.Running,
        updatedAt: "2025-01-02T00:00:00.000Z",
      });

      const updated = getJob(db, createJobId("job_1"));
      expect(updated!.status).toBe(JobStatus.Running);
      expect(updated!.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    });

    it("does nothing when no updates provided", () => {
      insertJob(db, makeJob("job_1"));
      const before = getJob(db, createJobId("job_1"));

      updateJob(db, createJobId("job_1"), {});

      const after = getJob(db, createJobId("job_1"));
      expect(after!.updatedAt).toBe(before!.updatedAt);
    });
  });

  describe("countJobsByRepo", () => {
    it("counts jobs by repo and statuses", () => {
      insertJob(db, makeJob("job_1", {
        status: JobStatus.Running,
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertJob(db, makeJob("job_2", {
        status: JobStatus.Queued,
        environment: { repo: "acme/app", branch: "dev", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertJob(db, makeJob("job_3", {
        status: JobStatus.Completed,
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const active = countJobsByRepo(db, "acme/app", ["running", "queued"]);
      expect(active).toBe(2);
    });
  });

  describe("countJobsActive", () => {
    it("counts active jobs", () => {
      insertJob(db, makeJob("job_1", { status: JobStatus.Running }));
      insertJob(db, makeJob("job_2", { status: JobStatus.Queued }));
      insertJob(db, makeJob("job_3", { status: JobStatus.Completed }));
      insertJob(db, makeJob("job_4", { status: JobStatus.Dispatched }));

      expect(countJobsActive(db)).toBe(3);
    });
  });

  describe("getQueuedJobs", () => {
    it("returns queued jobs ordered by priority desc then queuedAt asc", () => {
      insertJob(db, makeJob("job_low", {
        priority: JobPriority.Low,
        queuedAt: "2025-01-01T00:00:00.000Z",
      }));
      insertJob(db, makeJob("job_critical", {
        priority: JobPriority.Critical,
        queuedAt: "2025-01-02T00:00:00.000Z",
      }));
      insertJob(db, makeJob("job_normal", {
        priority: JobPriority.Normal,
        queuedAt: "2025-01-01T00:00:00.000Z",
      }));
      insertJob(db, makeJob("job_running", {
        status: JobStatus.Running,
        priority: JobPriority.Critical,
        queuedAt: "2025-01-01T00:00:00.000Z",
      }));

      const queued = getQueuedJobs(db);
      expect(queued).toHaveLength(3);
      expect(queued[0]!.id).toBe("job_critical");
      expect(queued[1]!.id).toBe("job_normal");
      expect(queued[2]!.id).toBe("job_low");
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertJob(db, makeJob(`job_${i}`));
      }

      const queued = getQueuedJobs(db, 3);
      expect(queued).toHaveLength(3);
    });
  });
});
