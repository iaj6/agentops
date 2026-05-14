import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  PolicyType,
  PolicySeverity,
  PolicyMode,
  getPolicyMode,
  runHasMutations,
} from "../policy.js";
import type { Policy } from "../policy.js";
import type { Run, Action } from "../types.js";
import { RunStatus, createRunId, createPolicyId, createActionId } from "../types.js";

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

    it("passes for read-only session even when tests are required", () => {
      const run = makeRun({ actions: [], evaluations: [] });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("No code changes");
    });

    it("fails when tests are required but none exist and run has mutations", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }])],
        evaluations: [],
      });
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
          name: "File limit",
          type: PolicyType.FileLimitCount,
          config: { type: PolicyType.FileLimitCount, maxFiles: 2 },
          severity: PolicySeverity.Warning,
        },
        {
          id: createPolicyId("p3"),
          name: "No risky ops",
          type: PolicyType.RiskyOpFlag,
          config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
          severity: PolicySeverity.Error,
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
      // File limit fails (3 > 2)
      expect(results[1]!.passed).toBe(false);
      // Risky ops passes (no risky commands)
      expect(results[2]!.passed).toBe(true);
    });
  });

  describe("SecretDetection policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_secret"),
      name: "No secrets",
      type: PolicyType.SecretDetection,
      config: {
        type: PolicyType.SecretDetection,
        patterns: [
          "AKIA[0-9A-Z]{16}",
          "-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----",
        ],
      },
      severity: PolicySeverity.Error,
    };

    it("passes when no secrets in file edits", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "src/index.ts", diff: "+const x = 1;", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("No secrets detected");
    });

    it("fails when AWS key pattern found in diff", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "src/config.ts", diff: "+const key = 'AKIAIOSFODNN7EXAMPLE';", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("Secrets detected");
    });

    it("fails when private key found in diff", () => {
      const run = makeRun({
        actions: [makeAction([{ path: "certs/key.pem", diff: "+-----BEGIN RSA PRIVATE KEY-----", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
    });

    it("handles multiple patterns, reports all matches", () => {
      const run = makeRun({
        actions: [makeAction([
          { path: "src/a.ts", diff: "+AKIAIOSFODNN7EXAMPLE", timestamp: "2025-01-01T00:00:00.000Z" },
          { path: "src/b.ts", diff: "+-----BEGIN PRIVATE KEY-----", timestamp: "2025-01-01T00:00:00.000Z" },
        ])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      const matched = (results[0]!.details as { matched: string[] }).matched;
      expect(matched.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("BranchProtection policy", () => {
    const policy: Policy = {
      id: createPolicyId("policy_branch"),
      name: "Protected branches",
      type: PolicyType.BranchProtection,
      config: {
        type: PolicyType.BranchProtection,
        protectedBranches: ["main", "master", "production"],
      },
      severity: PolicySeverity.Warning,
    };

    it("passes when branch is not protected", () => {
      const run = makeRun({
        environment: {
          repo: "test/repo",
          branch: "feature/foo",
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
        actions: [makeAction([{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("not protected");
    });

    it("fails when on main with file edits", () => {
      const run = makeRun({
        environment: {
          repo: "test/repo",
          branch: "main",
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
        actions: [makeAction([{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("Mutations on protected branch");
    });

    it("fails when on production with commands", () => {
      const run = makeRun({
        environment: {
          repo: "test/repo",
          branch: "production",
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
        actions: [makeAction([], [{ command: "npm run deploy", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-01-01T00:00:00.000Z" }])],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
    });

    it("passes when on protected branch but no actions", () => {
      const run = makeRun({
        environment: {
          repo: "test/repo",
          branch: "main",
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
        actions: [],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("no mutations detected");
    });
  });

  describe("ToolRestriction policy", () => {
    it("passes when tool is not in blocklist", () => {
      const policy: Policy = {
        id: createPolicyId("policy_tool_block"),
        name: "Block risky tools",
        type: PolicyType.ToolRestriction,
        config: {
          type: PolicyType.ToolRestriction,
          blockedTools: ["WebFetch", "WebSearch"],
        },
        severity: PolicySeverity.Warning,
      };
      const run = makeRun({
        actions: [{
          id: createActionId("action_tool1"),
          toolCalls: [{ name: "Read", input: {}, output: "", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("No restricted tools");
    });

    it("fails when tool is in blocklist", () => {
      const policy: Policy = {
        id: createPolicyId("policy_tool_block"),
        name: "Block risky tools",
        type: PolicyType.ToolRestriction,
        config: {
          type: PolicyType.ToolRestriction,
          blockedTools: ["WebFetch", "WebSearch"],
        },
        severity: PolicySeverity.Warning,
      };
      const run = makeRun({
        actions: [{
          id: createActionId("action_tool2"),
          toolCalls: [{ name: "WebFetch", input: {}, output: "", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("WebFetch");
    });

    it("passes when tool is in allowlist", () => {
      const policy: Policy = {
        id: createPolicyId("policy_tool_allow"),
        name: "Allow only safe tools",
        type: PolicyType.ToolRestriction,
        config: {
          type: PolicyType.ToolRestriction,
          allowedTools: ["Read", "Glob", "Grep", "Edit"],
        },
        severity: PolicySeverity.Error,
      };
      const run = makeRun({
        actions: [{
          id: createActionId("action_tool3"),
          toolCalls: [{ name: "Read", input: {}, output: "", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when tool is not in allowlist", () => {
      const policy: Policy = {
        id: createPolicyId("policy_tool_allow"),
        name: "Allow only safe tools",
        type: PolicyType.ToolRestriction,
        config: {
          type: PolicyType.ToolRestriction,
          allowedTools: ["Read", "Glob", "Grep", "Edit"],
        },
        severity: PolicySeverity.Error,
      };
      const run = makeRun({
        actions: [{
          id: createActionId("action_tool4"),
          toolCalls: [{ name: "Bash", input: {}, output: "", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("Bash");
    });
  });

  describe("getPolicyMode", () => {
    it("returns Guard for PathRestriction", () => {
      expect(getPolicyMode(PolicyType.PathRestriction)).toBe(PolicyMode.Guard);
    });

    it("returns Guard for FileLimitCount", () => {
      expect(getPolicyMode(PolicyType.FileLimitCount)).toBe(PolicyMode.Guard);
    });

    it("returns Guard for RiskyOpFlag", () => {
      expect(getPolicyMode(PolicyType.RiskyOpFlag)).toBe(PolicyMode.Guard);
    });

    it("returns Guard for SecretDetection", () => {
      expect(getPolicyMode(PolicyType.SecretDetection)).toBe(PolicyMode.Guard);
    });

    it("returns Guard for BranchProtection", () => {
      expect(getPolicyMode(PolicyType.BranchProtection)).toBe(PolicyMode.Guard);
    });

    it("returns Guard for ToolRestriction", () => {
      expect(getPolicyMode(PolicyType.ToolRestriction)).toBe(PolicyMode.Guard);
    });

    it("returns Check for TestEnforcement", () => {
      expect(getPolicyMode(PolicyType.TestEnforcement)).toBe(PolicyMode.Check);
    });

    it("returns Guard for CostCeiling", () => {
      expect(getPolicyMode(PolicyType.CostCeiling)).toBe(PolicyMode.Guard);
    });
  });

  describe("CostCeiling policy", () => {
    const policy: Policy = {
      id: createPolicyId("p_cost"),
      name: "Cost ceiling $5",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 5 },
      severity: PolicySeverity.Error,
    };

    it("passes when cost is below ceiling", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallTimeMs: 1,
          costUsd: 2.5,
          flakeRate: 0,
        },
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("within ceiling");
    });

    it("passes when cost equals ceiling", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallTimeMs: 1,
          costUsd: 5,
          flakeRate: 0,
        },
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(true);
    });

    it("fails when cost exceeds ceiling", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallTimeMs: 1,
          costUsd: 7.42,
          flakeRate: 0,
        },
      });
      const results = engine.evaluate(run, [policy]);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.message).toContain("$7.42");
      expect(results[0]!.message).toContain("exceeds");
    });
  });

  describe("Unknown policy type handling", () => {
    it("returns skipped result for unknown policy type", () => {
      const unknownPolicy: Policy = {
        id: createPolicyId("p_unknown"),
        name: "Legacy policy",
        type: "requiredApproval" as PolicyType,
        config: { type: "requiredApproval" as any, approvers: ["admin"] } as any,
        severity: PolicySeverity.Warning,
      };

      const run = makeRun();
      const results = engine.evaluate(run, [unknownPolicy]);
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.message).toContain("Skipped");
      expect(results[0]!.message).toContain("requiredApproval");
    });
  });
});

describe("runHasMutations", () => {
  it("returns false for a run with no actions", () => {
    const run = makeRun({ actions: [] });
    expect(runHasMutations(run)).toBe(false);
  });

  it("returns false for a run with only tool calls (no edits or commands)", () => {
    const run = makeRun({
      actions: [{
        id: createActionId("action_read"),
        toolCalls: [{ name: "Read", input: { file_path: "src/a.ts" }, output: "content", timestamp: "2025-01-01T00:00:00.000Z" }],
        fileEdits: [],
        commands: [],
        timestamp: "2025-01-01T00:00:00.000Z",
      }],
    });
    expect(runHasMutations(run)).toBe(false);
  });

  it("returns true for a run with file edits", () => {
    const run = makeRun({
      actions: [makeAction([{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }])],
    });
    expect(runHasMutations(run)).toBe(true);
  });

  it("returns true for a run with commands", () => {
    const run = makeRun({
      actions: [makeAction([], [{ command: "npm test", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-01-01T00:00:00.000Z" }])],
    });
    expect(runHasMutations(run)).toBe(true);
  });
});
