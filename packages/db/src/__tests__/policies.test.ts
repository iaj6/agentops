import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertPolicy, listPolicies, getPolicy, updatePolicy, getPolicyStats, insertPolicyResult, getPolicyResults } from "../policies.js";
import { insertRun } from "../runs.js";
import { policyResults } from "../schema.js";
import type { AgentOpsDb } from "../connection.js";
import { createPolicyId, createRunId, PolicyType, PolicySeverity, RunStatus } from "@agentops/core";
import type { Policy, Run } from "@agentops/core";

describe("Policies repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertPolicy and listPolicies", () => {
    it("inserts and lists policies", () => {
      const policy: Policy & { enabled: boolean; createdAt: string } = {
        id: createPolicyId("policy_1"),
        name: "No .env changes",
        type: PolicyType.PathRestriction,
        config: { type: PolicyType.PathRestriction, blockedPaths: [".env"] },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      };

      insertPolicy(db, policy);

      const results = listPolicies(db);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("policy_1");
      expect(results[0]!.name).toBe("No .env changes");
      expect(results[0]!.type).toBe(PolicyType.PathRestriction);
      expect(results[0]!.severity).toBe(PolicySeverity.Error);
      expect(results[0]!.enabled).toBe(true);
    });

    it("filters by type", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Path restriction",
        type: PolicyType.PathRestriction,
        config: { type: PolicyType.PathRestriction, blockedPaths: [".env"] },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      insertPolicy(db, {
        id: createPolicyId("p2"),
        name: "File limit",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      const results = listPolicies(db, { type: PolicyType.PathRestriction });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe(PolicyType.PathRestriction);
    });

    it("filters by enabled status", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Active policy",
        type: PolicyType.PathRestriction,
        config: { type: PolicyType.PathRestriction, blockedPaths: [] },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      insertPolicy(db, {
        id: createPolicyId("p2"),
        name: "Disabled policy",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 5 },
        severity: PolicySeverity.Warning,
        enabled: false,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      const enabled = listPolicies(db, { enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.name).toBe("Active policy");

      const disabled = listPolicies(db, { enabled: false });
      expect(disabled).toHaveLength(1);
      expect(disabled[0]!.name).toBe("Disabled policy");
    });

    it("returns empty array when no policies exist", () => {
      const results = listPolicies(db);
      expect(results).toEqual([]);
    });

    it("preserves JSON config through round-trip", () => {
      const config = {
        type: PolicyType.RiskyOpFlag as const,
        riskyPatterns: ["rm -rf", "DROP TABLE", "sudo"],
      };

      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Risky ops",
        type: PolicyType.RiskyOpFlag,
        config,
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      const results = listPolicies(db);
      const retrieved = results[0]!.config as { type: string; riskyPatterns: string[] };
      expect(retrieved.riskyPatterns).toEqual(["rm -rf", "DROP TABLE", "sudo"]);
    });
  });

  describe("getPolicy", () => {
    it("retrieves a single policy by id", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Test policy",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 10 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      const policy = getPolicy(db, createPolicyId("p1"));
      expect(policy).not.toBeNull();
      expect(policy!.id).toBe("p1");
      expect(policy!.name).toBe("Test policy");
      expect(policy!.type).toBe(PolicyType.FileLimitCount);
      expect(policy!.enabled).toBe(true);
    });

    it("returns null for non-existent policy", () => {
      const result = getPolicy(db, createPolicyId("nonexistent"));
      expect(result).toBeNull();
    });
  });

  describe("updatePolicy", () => {
    it("updates policy name", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Original name",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      updatePolicy(db, createPolicyId("p1"), { name: "Updated name" });

      const policy = getPolicy(db, createPolicyId("p1"));
      expect(policy!.name).toBe("Updated name");
    });

    it("updates policy enabled status", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Toggle test",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      updatePolicy(db, createPolicyId("p1"), { enabled: false });

      const policy = getPolicy(db, createPolicyId("p1"));
      expect(policy!.enabled).toBe(false);
    });

    it("updates severity", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Severity test",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      updatePolicy(db, createPolicyId("p1"), { severity: PolicySeverity.Error });

      const policy = getPolicy(db, createPolicyId("p1"));
      expect(policy!.severity).toBe(PolicySeverity.Error);
    });

    it("does nothing when updates object is empty", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "No change",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Warning,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      updatePolicy(db, createPolicyId("p1"), {});

      const policy = getPolicy(db, createPolicyId("p1"));
      expect(policy!.name).toBe("No change");
    });
  });

  describe("getPolicyStats", () => {
    function makeRun(id: string): Run {
      return {
        id: createRunId(id),
        status: RunStatus.Completed,
        goal: {
          humanReadable: "Test",
          structured: { type: "task", description: "Test", parameters: {} },
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
          costUsd: 0.5,
          flakeRate: 0,
        },
        evaluations: [],
        decisions: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
    }

    it("returns correct pass/fail counts", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Test policy",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      // Insert runs to satisfy foreign key
      insertRun(db, makeRun("run_1"));
      insertRun(db, makeRun("run_2"));
      insertRun(db, makeRun("run_3"));

      // Insert policy results
      db.insert(policyResults).values({
        id: "pr_1",
        runId: "run_1",
        policyId: "p1",
        passed: true,
        message: "OK",
        details: {} as Record<string, unknown>,
        evaluatedAt: "2025-01-01T00:00:00.000Z",
      }).run();

      db.insert(policyResults).values({
        id: "pr_2",
        runId: "run_2",
        policyId: "p1",
        passed: true,
        message: "OK",
        details: {} as Record<string, unknown>,
        evaluatedAt: "2025-01-01T00:00:00.000Z",
      }).run();

      db.insert(policyResults).values({
        id: "pr_3",
        runId: "run_3",
        policyId: "p1",
        passed: false,
        message: "Exceeded cost",
        details: {} as Record<string, unknown>,
        evaluatedAt: "2025-01-01T00:00:00.000Z",
      }).run();

      const stats = getPolicyStats(db, createPolicyId("p1"));
      expect(stats.total).toBe(3);
      expect(stats.passed).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it("returns zeros when no results exist", () => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Empty policy",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });

      const stats = getPolicyStats(db, createPolicyId("p1"));
      expect(stats.total).toBe(0);
      expect(stats.passed).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe("insertPolicyResult", () => {
    function makeRun(id: string): Run {
      return {
        id: createRunId(id),
        status: RunStatus.Completed,
        goal: {
          humanReadable: "Test",
          structured: { type: "task", description: "Test", parameters: {} },
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
          costUsd: 0.5,
          flakeRate: 0,
        },
        evaluations: [],
        decisions: [],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
    }

    beforeEach(() => {
      insertPolicy(db, {
        id: createPolicyId("p1"),
        name: "Test policy",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
        severity: PolicySeverity.Error,
        enabled: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      insertRun(db, makeRun("run_a"));
    });

    it("round-trip: row comes back with exact passed, message, details, evaluatedAt", () => {
      insertPolicyResult(db, {
        id: "pr_rt_1",
        runId: "run_a",
        policyId: "p1",
        passed: false,
        message: "Cost ceiling exceeded",
        details: { threshold: 10, actual: 12.5 },
        evaluatedAt: "2025-06-01T12:00:00.000Z",
      });

      const rows = getPolicyResults(db, createRunId("run_a"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.passed).toBe(false);
      expect(rows[0]!.message).toBe("Cost ceiling exceeded");
      expect(rows[0]!.evaluatedAt).toBe("2025-06-01T12:00:00.000Z");
    });

    it("details JSON column round-trips a nested object", () => {
      insertPolicyResult(db, {
        id: "pr_rt_2",
        runId: "run_a",
        policyId: "p1",
        passed: true,
        message: "OK",
        details: { source: "pre-tool", toolName: "Bash" },
        evaluatedAt: "2025-06-01T13:00:00.000Z",
      });

      const rows = getPolicyResults(db, createRunId("run_a"));
      expect(rows[0]!.details).toEqual({ source: "pre-tool", toolName: "Bash" });
    });

    it("multiple rows for same (runId, policyId) are all returned", () => {
      insertRun(db, makeRun("run_b"));

      insertPolicyResult(db, {
        id: "pr_multi_1",
        runId: "run_a",
        policyId: "p1",
        passed: false,
        message: "blocked at pre-tool",
        details: { phase: "pre-tool" },
        evaluatedAt: "2025-06-01T14:00:00.000Z",
      });

      insertPolicyResult(db, {
        id: "pr_multi_2",
        runId: "run_a",
        policyId: "p1",
        passed: false,
        message: "failed at run-complete rollup",
        details: { phase: "run-complete" },
        evaluatedAt: "2025-06-01T14:01:00.000Z",
      });

      const rows = getPolicyResults(db, createRunId("run_a"));
      expect(rows).toHaveLength(2);
      const phases = rows.map((r) => (r.details as { phase: string }).phase);
      expect(phases).toContain("pre-tool");
      expect(phases).toContain("run-complete");
    });
  });
});
