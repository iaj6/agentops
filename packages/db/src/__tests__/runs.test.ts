import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import {
  insertRun,
  getRun,
  listRuns,
  updateRun,
  deleteOldRuns,
  countRunsOlderThan,
  vacuum,
} from "../runs.js";
import { insertPolicy, insertPolicyResult } from "../policies.js";
import { insertEvent } from "../events.js";
import type { AgentOpsDb } from "../connection.js";
import type { Run } from "@agentops/core";
import {
  createPolicyId,
  createRunId,
  RunStatus,
  PolicySeverity,
  PolicyType,
  createEvent,
  EventCategory,
  EVENT_TYPES,
} from "@agentops/core";

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id: createRunId(id),
    status: RunStatus.Running,
    goal: {
      humanReadable: "Test goal",
      structured: { type: "task", description: "Test goal", parameters: {} },
    },
    agents: [],
    environment: {
      repo: "test/repo",
      branch: "main",
      permissions: [],
      sandbox: { enabled: false, isolationLevel: "none" },
    },
    actions: [],
    artifacts: [],
    metrics: {
      tokenUsage: { input: 100, output: 50, total: 150 },
      wallTimeMs: 1000,
      costUsd: 0.50,
      flakeRate: 0,
    },
    evaluations: [],
    decisions: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Runs repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertRun and getRun", () => {
    it("inserts and retrieves a run", () => {
      const run = makeRun("run_1");
      insertRun(db, run);

      const retrieved = getRun(db, createRunId("run_1"));
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("run_1");
      expect(retrieved!.status).toBe(RunStatus.Running);
      expect(retrieved!.goal.humanReadable).toBe("Test goal");
      expect(retrieved!.environment.repo).toBe("test/repo");
      expect(retrieved!.metrics.costUsd).toBe(0.50);
    });

    it("returns null for non-existent run", () => {
      const result = getRun(db, createRunId("nonexistent"));
      expect(result).toBeNull();
    });

    it("preserves complex nested data", () => {
      const run = makeRun("run_complex", {
        agents: [{ id: "agent_1" as any, model: "gpt-4", role: "lead" as any }],
        actions: [{
          id: "action_1" as any,
          toolCalls: [{ name: "read_file", input: { path: "src/index.ts" }, output: "content", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [{ path: "src/index.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }],
          commands: [{ command: "npm test", exitCode: 0, stdout: "ok", stderr: "", timestamp: "2025-01-01T00:00:00.000Z" }],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
        evaluations: [{
          testResults: [{ name: "test1", passed: true, duration: 10, message: "ok" }],
          policyChecks: [],
          confidenceScore: 0.95,
        }],
      });

      insertRun(db, run);
      const retrieved = getRun(db, createRunId("run_complex"));

      expect(retrieved!.agents).toHaveLength(1);
      expect(retrieved!.actions).toHaveLength(1);
      expect(retrieved!.actions[0]!.toolCalls).toHaveLength(1);
      expect(retrieved!.evaluations).toHaveLength(1);
      expect(retrieved!.evaluations[0]!.testResults[0]!.passed).toBe(true);
    });
  });

  describe("listRuns", () => {
    it("lists all runs ordered by createdAt descending", () => {
      insertRun(db, makeRun("run_1", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_2", { createdAt: "2025-01-02T00:00:00.000Z" }));
      insertRun(db, makeRun("run_3", { createdAt: "2025-01-03T00:00:00.000Z" }));

      const results = listRuns(db);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("run_3");
      expect(results[1]!.id).toBe("run_2");
      expect(results[2]!.id).toBe("run_1");
    });

    it("filters by status", () => {
      insertRun(db, makeRun("run_1", { status: RunStatus.Running }));
      insertRun(db, makeRun("run_2", { status: RunStatus.Completed }));
      insertRun(db, makeRun("run_3", { status: RunStatus.Running }));

      const results = listRuns(db, { status: "running" });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === RunStatus.Running)).toBe(true);
    });

    it("filters by repo", () => {
      insertRun(db, makeRun("run_1", { environment: { repo: "org/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } } }));
      insertRun(db, makeRun("run_2", { environment: { repo: "org/lib", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } } }));

      const results = listRuns(db, { repo: "org/app" });
      expect(results).toHaveLength(1);
      expect(results[0]!.environment.repo).toBe("org/app");
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertRun(db, makeRun(`run_${i}`, { createdAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
      }

      const results = listRuns(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("returns empty array when no runs match", () => {
      const results = listRuns(db, { status: "completed" });
      expect(results).toEqual([]);
    });
  });

  describe("updateRun", () => {
    it("updates run status", () => {
      insertRun(db, makeRun("run_1", { status: RunStatus.Running }));

      updateRun(db, createRunId("run_1"), {
        status: RunStatus.Completed,
        updatedAt: "2025-01-02T00:00:00.000Z",
      });

      const updated = getRun(db, createRunId("run_1"));
      expect(updated!.status).toBe(RunStatus.Completed);
      expect(updated!.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    });

    it("updates evaluations", () => {
      insertRun(db, makeRun("run_1"));

      updateRun(db, createRunId("run_1"), {
        evaluations: [{
          testResults: [{ name: "test1", passed: true, duration: 10, message: "ok" }],
          policyChecks: [],
          confidenceScore: 0.9,
        }],
      });

      const updated = getRun(db, createRunId("run_1"));
      expect(updated!.evaluations).toHaveLength(1);
      expect(updated!.evaluations[0]!.testResults[0]!.name).toBe("test1");
    });

    it("does nothing when no updates provided", () => {
      insertRun(db, makeRun("run_1"));
      const before = getRun(db, createRunId("run_1"));

      updateRun(db, createRunId("run_1"), {});

      const after = getRun(db, createRunId("run_1"));
      expect(after!.updatedAt).toBe(before!.updatedAt);
    });
  });

  describe("data retention (Phase C3)", () => {
    function seedPolicy(id = "p_test") {
      insertPolicy(db, {
        id: createPolicyId(id),
        name: `Test policy ${id}`,
        type: PolicyType.RiskyOpFlag,
        config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm"] },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2024-01-01T00:00:00.000Z",
      });
    }

    function seedRunAt(id: string, isoTimestamp: string) {
      insertRun(db, makeRun(id, { createdAt: isoTimestamp, updatedAt: isoTimestamp }));
    }

    it("countRunsOlderThan returns 0 on an empty DB", () => {
      expect(countRunsOlderThan(db, "2026-01-01T00:00:00.000Z")).toBe(0);
    });

    it("countRunsOlderThan counts runs strictly older than the cutoff", () => {
      seedRunAt("run_old_1", "2025-01-01T00:00:00.000Z");
      seedRunAt("run_old_2", "2025-06-01T00:00:00.000Z");
      seedRunAt("run_new", "2026-05-01T00:00:00.000Z");
      expect(countRunsOlderThan(db, "2026-01-01T00:00:00.000Z")).toBe(2);
      expect(countRunsOlderThan(db, "2024-12-31T23:59:59.999Z")).toBe(0);
    });

    it("deleteOldRuns removes nothing when no runs match", () => {
      seedRunAt("run_new", "2026-05-15T00:00:00.000Z");
      const result = deleteOldRuns(db, "2020-01-01T00:00:00.000Z");
      expect(result.runs).toBe(0);
      expect(result.runIds).toEqual([]);
      expect(getRun(db, createRunId("run_new"))).not.toBeNull();
    });

    it("deleteOldRuns drops matching runs + cascades to children", () => {
      seedPolicy("p_keep");
      seedRunAt("run_doomed", "2025-01-01T00:00:00.000Z");
      seedRunAt("run_keep", "2026-05-01T00:00:00.000Z");

      // Seed dependent rows for the doomed run.
      insertPolicyResult(db, {
        id: "pr_doomed",
        runId: "run_doomed",
        policyId: "p_keep",
        passed: false,
        message: "old fire",
        details: { source: "pre-tool" },
        evaluatedAt: "2025-01-01T00:00:01.000Z",
      });
      insertEvent(
        db,
        createEvent(EventCategory.Run, EVENT_TYPES["run.started"], "run_doomed", {}),
      );
      // And a dependent row for the surviving run (must NOT be deleted).
      insertPolicyResult(db, {
        id: "pr_keep",
        runId: "run_keep",
        policyId: "p_keep",
        passed: true,
        message: "ok",
        details: {},
        evaluatedAt: "2026-05-01T00:00:01.000Z",
      });

      const result = deleteOldRuns(db, "2026-01-01T00:00:00.000Z");
      expect(result.runs).toBe(1);
      expect(result.policyResults).toBe(1);
      expect(result.events).toBe(1);
      expect(result.runIds).toEqual(["run_doomed"]);

      expect(getRun(db, createRunId("run_doomed"))).toBeNull();
      expect(getRun(db, createRunId("run_keep"))).not.toBeNull();
    });

    it("vacuum runs without throwing", () => {
      expect(() => vacuum(db)).not.toThrow();
    });
  });
});
