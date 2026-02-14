import { describe, it, expect } from "vitest";
import {
  createRun,
  startRun,
  addAction,
  addArtifact,
  completeRun,
  RunStatus,
  createActionId,
  createArtifactId,
  createPolicyId,
  PolicyEngine,
  PolicyType,
  PolicySeverity,
  computeScore,
  MergeRecommendation,
} from "../index.js";
import type { Run, Action, Artifact, Evaluation, Policy } from "../index.js";

describe("Integration: full run lifecycle", () => {
  it("create -> add actions -> evaluate policies -> compute score -> complete", () => {
    // 1. Create a new run
    let run = createRun(
      {
        humanReadable: "Fix authentication bug",
        structured: { type: "bugfix", description: "Fix auth bypass", parameters: { priority: "high" } },
      },
      {
        repo: "myorg/myapp",
        branch: "fix/auth-bug",
        permissions: ["read", "write"],
        sandbox: { enabled: true, isolationLevel: "container" },
      },
    );

    expect(run.status).toBe(RunStatus.Pending);
    expect(run.actions).toHaveLength(0);

    // 2. Start the run
    run = startRun(run);
    expect(run.status).toBe(RunStatus.Running);

    // 3. Add actions (file edits, tool calls, commands)
    const action1: Action = {
      id: createActionId("action_1"),
      toolCalls: [
        { name: "read_file", input: { path: "src/auth.ts" }, output: "file contents", timestamp: "2025-01-01T00:00:00.000Z" },
      ],
      fileEdits: [
        { path: "src/auth.ts", diff: "+  if (!token) throw new Error('unauthorized');", timestamp: "2025-01-01T00:00:01.000Z" },
      ],
      commands: [
        { command: "npm test", exitCode: 0, stdout: "all tests pass", stderr: "", timestamp: "2025-01-01T00:00:02.000Z" },
      ],
      timestamp: "2025-01-01T00:00:00.000Z",
    };
    run = addAction(run, action1);
    expect(run.actions).toHaveLength(1);

    // 4. Add an artifact
    const artifact: Artifact = {
      id: createArtifactId("artifact_1"),
      diffs: ["diff --git a/src/auth.ts b/src/auth.ts"],
      logs: ["Build succeeded"],
      testOutputs: ["3 tests passed"],
      reports: [],
    };
    run = addArtifact(run, artifact);
    expect(run.artifacts).toHaveLength(1);

    // 5. Evaluate policies
    const policies: Policy[] = [
      {
        id: createPolicyId("p1"),
        name: "No .env changes",
        type: PolicyType.PathRestriction,
        config: { type: PolicyType.PathRestriction, blockedPaths: [".env", "secrets/"] },
        severity: PolicySeverity.Error,
      },
      {
        id: createPolicyId("p2"),
        name: "File limit",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 10 },
        severity: PolicySeverity.Warning,
      },
      {
        id: createPolicyId("p3"),
        name: "Max 10 files",
        type: PolicyType.FileLimitCount,
        config: { type: PolicyType.FileLimitCount, maxFiles: 10 },
        severity: PolicySeverity.Warning,
      },
    ];

    const engine = new PolicyEngine();
    const policyResults = engine.evaluate(run, policies);

    expect(policyResults).toHaveLength(3);
    expect(policyResults.every((r) => r.passed)).toBe(true);

    // 6. Complete the run with evaluation results
    const evaluation: Evaluation = {
      testResults: [
        { name: "auth token validation", passed: true, duration: 50, message: "ok" },
        { name: "auth bypass prevention", passed: true, duration: 30, message: "ok" },
        { name: "auth error handling", passed: true, duration: 20, message: "ok" },
      ],
      policyChecks: policyResults.map((r) => ({
        policyId: r.policy.id,
        passed: r.passed,
        message: r.message,
      })),
      confidenceScore: 0.95,
    };
    run = completeRun(run, evaluation);

    expect(run.status).toBe(RunStatus.Completed);
    expect(run.evaluations).toHaveLength(1);

    // 7. Compute score
    const scoreCard = computeScore(run, policies);

    expect(scoreCard.correctness.score).toBe(1); // all 3 tests pass
    expect(scoreCard.regressionRisk.score).toBe(1); // no failures, no flakes
    expect(scoreCard.scopeRisk.score).toBe(1); // 1 file changed
    expect(scoreCard.policyCompliance.score).toBe(1); // all policies pass
    expect(scoreCard.unknowns.score).toBe(1); // has tests, artifacts, evaluations
    expect(scoreCard.mergeRecommendation).toBe(MergeRecommendation.Merge);
  });

  it("handles a failing run lifecycle", () => {
    let run = createRun(
      {
        humanReadable: "Refactor database layer",
        structured: { type: "refactor", description: "Refactor DB", parameters: {} },
      },
      {
        repo: "myorg/myapp",
        branch: "refactor/db",
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
    );

    run = startRun(run);

    // Many file edits
    const edits = Array.from({ length: 12 }, (_, i) => ({
      path: `src/db/file${i}.ts`,
      diff: "+refactored",
      timestamp: "2025-01-01T00:00:00.000Z",
    }));

    run = addAction(run, {
      id: createActionId("action_1"),
      toolCalls: [],
      fileEdits: edits,
      commands: [],
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    // Complete with failing tests
    const evaluation: Evaluation = {
      testResults: [
        { name: "db connection", passed: true, duration: 50, message: "ok" },
        { name: "db migration", passed: false, duration: 30, message: "table not found" },
        { name: "db query", passed: false, duration: 20, message: "syntax error" },
      ],
      policyChecks: [],
      confidenceScore: 0.33,
    };
    run = completeRun(run, evaluation);

    const scoreCard = computeScore(run);

    // 1/3 passing
    expect(scoreCard.correctness.score).toBeCloseTo(0.333, 2);
    // 2 failures
    expect(scoreCard.regressionRisk.score).toBeCloseTo(0.333, 2);
    // 12 files is large scope
    expect(scoreCard.scopeRisk.score).toBeLessThan(0.5);
    expect(scoreCard.mergeRecommendation).toBe(MergeRecommendation.Block);
  });
});
