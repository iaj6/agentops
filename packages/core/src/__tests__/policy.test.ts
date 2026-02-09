import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  PolicyType,
  PolicySeverity,
} from "../policy.js";
import type { Policy } from "../policy.js";
import type { Run, Action } from "../types.js";
import { RunStatus, createRunId, createPolicyId, createActionId, DecisionType, createDecisionId } from "../types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: createRunId("run_test"),
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

function makeAction(fileEdits: Action["fileEdits"] = [], commands: Action["commands"] = []): Action {
  return {
    id: createActionId("action_1"),
    toolCalls: [],
    fileEdits,
    commands,
    timestamp: "2025-01-01T00:00:00.000Z",
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("PathRestriction policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_path"),
      name: "No .env changes",
      type: PolicyType.PathRestriction,
      config: {
        type: PolicyType.PathRestriction,
        blockedPaths: [".env", "secrets/"],
      },
      severity: PolicySeverity.Error,
    };

    it("passes when no restricted paths are modified", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "src/index.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });

      const results = engine.evaluate(run, [policy]);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("No restricted paths");
    });

    it("fails when a restricted path is modified", () => {
      const run = makeRun({
        actions: [makeAction([{ path: ".env", diff: "+SECRET=123", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });

      const results = engine.evaluate(run, [policy]);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain(".env");
    });

    it("fails when a path in blocked directory is modified", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "secrets/api_key.txt", diff: "+key", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });

      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("secrets/api_key.txt");
    });
  });

  describe("FileLimitCount policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_filelimit"),
      name: "Max 5 files",
      type: PolicyType.FileLimitCount,
      config: {
        type: PolicyType.FileLimitCount,
        maxFiles: 5,
      },
      severity: PolicySeverity.Warning,
    };

    it("passes when file count is within limit", () => {
      const edits = Array.from({ length: 3 }, (_, i) => ({
        path: `src/file${i}.ts`,
        diff: "+code",
        timestamp: "2025-01-01T00:00:00.000Z",
      }));
      const run = makeRun({ actions: [makeAction(edits)] });

      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when too many files are edited", () => {
      const edits = Array.from({ length: 8 }, (_, i) => ({
        path: `src/file${i}.ts`,
        diff: "+code",
        timestamp: "2025-01-01T00:00:00.000Z",
      }));
      const run = makeRun({ actions: [makeAction(edits)] });

      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("exceeds limit");
    });

    it("deduplicates files across actions", () => {
      const action1 = makeAction([{ path: "src/a.ts", diff: "+a", timestamp: "2025-01-01T00:00:00.000Z" }]);
      const action2: Action = {
        id: createActionId("action_2"),
        toolCalls: [],
        fileEdits: [{ path: "src/a.ts", diff: "+b", timestamp: "2025-01-01T00:00:00.000Z" }],
        commands: [],
        timestamp: "2025-01-01T00:00:00.000Z",
      };
      const run = makeRun({ actions: [action1, action2] });

      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect((results[0]!.details as { count: number }).count).toBe(1);
    });
  });

  describe("CostCeiling policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_cost"),
      name: "Cost ceiling $1.00",
      type: PolicyType.CostCeiling,
      config: {
        type: PolicyType.CostCeiling,
        maxCostUsd: 1.0,
      },
      severity: PolicySeverity.Error,
    };

    it("passes when cost is within ceiling", () => {
      const run = makeRun({ metrics: { tokenUsage: { input: 0, output: 0, total: 0 }, wallTimeMs: 0, costUsd: 0.50, flakeRate: 0 } });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when cost exceeds ceiling", () => {
      const run = makeRun({ metrics: { tokenUsage: { input: 0, output: 0, total: 0 }, wallTimeMs: 0, costUsd: 2.50, flakeRate: 0 } });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("exceeds ceiling");
    });

    it("passes when cost equals ceiling exactly", () => {
      const run = makeRun({ metrics: { tokenUsage: { input: 0, output: 0, total: 0 }, wallTimeMs: 0, costUsd: 1.0, flakeRate: 0 } });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });
  });

  describe("RequiredApproval policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_approval"),
      name: "Requires lead approval",
      type: PolicyType.RequiredApproval,
      config: {
        type: PolicyType.RequiredApproval,
        approvers: ["lead", "reviewer"],
      },
      severity: PolicySeverity.Error,
    };

    it("passes when all approvals are present", () => {
      const run = makeRun({
        decisions: [
          { id: createDecisionId("d1"), type: DecisionType.Approval, actor: "lead", reason: "LGTM", timestamp: "2025-01-01T00:00:00.000Z" },
          { id: createDecisionId("d2"), type: DecisionType.Approval, actor: "reviewer", reason: "Looks good", timestamp: "2025-01-01T00:00:00.000Z" },
        ],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when approvals are missing", () => {
      const run = makeRun({
        decisions: [
          { id: createDecisionId("d1"), type: DecisionType.Approval, actor: "lead", reason: "LGTM", timestamp: "2025-01-01T00:00:00.000Z" },
        ],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("reviewer");
    });
  });

  describe("TestEnforcement policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_tests"),
      name: "Tests must pass",
      type: PolicyType.TestEnforcement,
      config: {
        type: PolicyType.TestEnforcement,
        requirePassing: true,
        minCoverage: 80,
      },
      severity: PolicySeverity.Error,
    };

    it("passes when all tests pass", () => {
      const run = makeRun({
        evaluations: [{
          testResults: [
            { name: "test1", passed: true, duration: 10, message: "ok" },
            { name: "test2", passed: true, duration: 20, message: "ok" },
          ],
          policyChecks: [],
          confidenceScore: 1,
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when tests are required but none exist", () => {
      const run = makeRun({ evaluations: [] });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("No test results found");
    });

    it("fails when some tests fail", () => {
      const run = makeRun({
        evaluations: [{
          testResults: [
            { name: "test1", passed: true, duration: 10, message: "ok" },
            { name: "test2", passed: false, duration: 20, message: "assertion failed" },
          ],
          policyChecks: [],
          confidenceScore: 0.5,
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("failing");
    });
  });

  describe("RiskyOpFlag policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_risky"),
      name: "No dangerous commands",
      type: PolicyType.RiskyOpFlag,
      config: {
        type: PolicyType.RiskyOpFlag,
        riskyPatterns: ["rm -rf", "DROP TABLE"],
      },
      severity: PolicySeverity.Error,
    };

    it("passes when no risky commands are used", () => {
      const run = makeRun({
        actions: [makeAction([], [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when risky commands are detected", () => {
      const run = makeRun({
        actions: [makeAction([], [{ command: "rm -rf /tmp/data", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("Risky operations detected");
    });
  });

  describe("Multiple policies evaluated together", () => {
    it("evaluates all policies and returns results for each", () => {
      const policies: Policy[] = [
        {
          id: createPolicyId("p1"),
          name: "Path restriction",
          type: PolicyType.PathRestriction,
          config: { type: PolicyType.PathRestriction, blockedPaths: [".env"] },
          severity: PolicySeverity.Error,
        },
        {
          id: createPolicyId("p2"),
          name: "Cost ceiling",
          type: PolicyType.CostCeiling,
          config: { type: PolicyType.CostCeiling, maxCostUsd: 10.0 },
          severity: PolicySeverity.Warning,
        },
        {
          id: createPolicyId("p3"),
          name: "File limit",
          type: PolicyType.FileLimitCount,
          config: { type: PolicyType.FileLimitCount, maxFiles: 2 },
          severity: PolicySeverity.Warning,
        },
      ];

      const run = makeRun({
        actions: [makeAction([
          { path: "src/a.ts", diff: "+a", timestamp: "2025-01-01T00:00:00.000Z" },
          { path: "src/b.ts", diff: "+b", timestamp: "2025-01-01T00:00:00.000Z" },
          { path: "src/c.ts", diff: "+c", timestamp: "2025-01-01T00:00:00.000Z" },
        ])],
      });

      const results = engine.evaluate(run, policies);
      expect(results).toHaveLength(3);

      // Path restriction passes (no .env changes)
      expect(results[0]!.passed).toBe(true);
      // Cost ceiling passes (0.50 < 10.0)
      expect(results[1]!.passed).toBe(true);
      // File limit fails (3 > 2)
      expect(results[2]!.passed).toBe(false);
    });
  });
});
