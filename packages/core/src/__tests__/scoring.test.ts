import { describe, it, expect } from "vitest";
import { computeScore, MergeRecommendation } from "../scoring.js";
import type { Run } from "../types.js";
import { RunStatus, createRunId, createActionId, createArtifactId } from "../types.js";
import type { Policy } from "../policy.js";
import { PolicyType, PolicySeverity } from "../policy.js";
import { createPolicyId } from "../types.js";

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

describe("computeScore", () => {
  describe("non-completed run", () => {
    it("returns Block recommendation for a pending run", () => {
      const run = makeRun({ status: RunStatus.Pending });
      const score = computeScore(run);

      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
      expect(score.correctness.score).toBe(0);
      expect(score.correctness.rationale).toContain("pending");
    });

    it("returns Block recommendation for a failed run", () => {
      const run = makeRun({ status: RunStatus.Failed });
      const score = computeScore(run);

      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
    });

    it("returns Block recommendation for a running run", () => {
      const run = makeRun({ status: RunStatus.Running });
      const score = computeScore(run);

      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
    });
  });

  describe("clean run with passing tests", () => {
    it("returns high scores and Merge recommendation", () => {
      const run = makeRun({
        evaluations: [{
          testResults: [
            { name: "test1", passed: true, duration: 10, message: "ok" },
            { name: "test2", passed: true, duration: 20, message: "ok" },
            { name: "test3", passed: true, duration: 5, message: "ok" },
          ],
          policyChecks: [],
          confidenceScore: 1,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: ["diff"], logs: ["log"], testOutputs: ["out"], reports: [] }],
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [{ path: "src/index.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }],
            commands: [],
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        ],
      });

      const score = computeScore(run);

      expect(score.correctness.score).toBe(1);
      expect(score.regressionRisk.score).toBe(1);
      expect(score.scopeRisk.score).toBe(1); // 1 file = small scope
      expect(score.policyCompliance.score).toBe(1); // no policies = full compliance
      expect(score.unknowns.score).toBe(1); // has tests, artifacts, evaluations
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Merge);
    });
  });

  describe("run with test failures", () => {
    it("returns low correctness and Block recommendation", () => {
      const run = makeRun({
        evaluations: [{
          testResults: [
            { name: "test1", passed: true, duration: 10, message: "ok" },
            { name: "test2", passed: false, duration: 20, message: "assertion error" },
            { name: "test3", passed: false, duration: 5, message: "timeout" },
          ],
          policyChecks: [],
          confidenceScore: 0.33,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: [], logs: [], testOutputs: [], reports: [] }],
      });

      const score = computeScore(run);

      // 1/3 passing = 0.333...
      expect(score.correctness.score).toBeCloseTo(0.333, 2);
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
    });
  });

  describe("run with policy violations", () => {
    it("returns low compliance and Block recommendation", () => {
      const run = makeRun({
        evaluations: [{
          testResults: [
            { name: "test1", passed: true, duration: 10, message: "ok" },
          ],
          policyChecks: [],
          confidenceScore: 1,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: [], logs: [], testOutputs: [], reports: [] }],
        actions: [{
          id: createActionId("a1"),
          toolCalls: [],
          fileEdits: [{ path: ".env", diff: "+SECRET=xyz", timestamp: "2025-01-01T00:00:00.000Z" }],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });

      const policies: Policy[] = [
        {
          id: createPolicyId("p1"),
          name: "No .env",
          type: PolicyType.PathRestriction,
          config: { type: PolicyType.PathRestriction, blockedPaths: [".env"] },
          severity: PolicySeverity.Error,
        },
      ];

      const score = computeScore(run, policies);

      expect(score.policyCompliance.score).toBe(0);
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
    });
  });

  describe("run with no tests but has mutations", () => {
    it("returns unknown score and Block recommendation", () => {
      const run = makeRun({
        actions: [{
          id: createActionId("a1"),
          toolCalls: [],
          fileEdits: [{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
        evaluations: [],
        artifacts: [],
      });

      const score = computeScore(run);

      expect(score.correctness.score).toBe(0);
      expect(score.unknowns.score).toBeLessThan(0.5);
      expect(score.unknowns.rationale).toContain("no tests");
      // With correctness at 0, should be Block
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Block);
    });
  });

  describe("read-only session (no mutations)", () => {
    it("returns Merge recommendation with high scores", () => {
      const run = makeRun({
        actions: [],
        evaluations: [],
        artifacts: [],
      });

      const score = computeScore(run);

      expect(score.correctness.score).toBe(1);
      expect(score.correctness.rationale).toContain("Read-only");
      expect(score.regressionRisk.score).toBe(1);
      expect(score.regressionRisk.rationale).toContain("Read-only");
      expect(score.unknowns.score).toBe(1);
      expect(score.unknowns.rationale).toContain("Read-only");
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Merge);
    });

    it("handles run with only Read tool calls (no edits or commands)", () => {
      const run = makeRun({
        actions: [{
          id: createActionId("a_read"),
          toolCalls: [{ name: "Read", input: { file_path: "src/a.ts" }, output: "content", timestamp: "2025-01-01T00:00:00.000Z" }],
          fileEdits: [],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
        evaluations: [],
        artifacts: [],
      });

      const score = computeScore(run);

      expect(score.correctness.score).toBe(1);
      expect(score.regressionRisk.score).toBe(1);
      expect(score.unknowns.score).toBe(1);
      expect(score.mergeRecommendation).toBe(MergeRecommendation.Merge);
    });
  });

  describe("run with large scope", () => {
    it("returns lower scope risk for many files", () => {
      const edits = Array.from({ length: 15 }, (_, i) => ({
        path: `src/file${i}.ts`,
        diff: "+code",
        timestamp: "2025-01-01T00:00:00.000Z",
      }));

      const run = makeRun({
        evaluations: [{
          testResults: [{ name: "test1", passed: true, duration: 10, message: "ok" }],
          policyChecks: [],
          confidenceScore: 1,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: [], logs: [], testOutputs: [], reports: [] }],
        actions: [{
          id: createActionId("a1"),
          toolCalls: [],
          fileEdits: edits,
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });

      const score = computeScore(run);

      // 15 files is a "large scope"
      expect(score.scopeRisk.score).toBeLessThan(0.5);
      expect(score.scopeRisk.rationale).toContain("Large scope");
    });
  });

  describe("run with moderate scope", () => {
    it("returns moderate scope risk for 5-10 files", () => {
      const edits = Array.from({ length: 7 }, (_, i) => ({
        path: `src/file${i}.ts`,
        diff: "+code",
        timestamp: "2025-01-01T00:00:00.000Z",
      }));

      const run = makeRun({
        evaluations: [{
          testResults: [{ name: "test1", passed: true, duration: 10, message: "ok" }],
          policyChecks: [],
          confidenceScore: 1,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: [], logs: [], testOutputs: [], reports: [] }],
        actions: [{
          id: createActionId("a1"),
          toolCalls: [],
          fileEdits: edits,
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });

      const score = computeScore(run);

      expect(score.scopeRisk.score).toBeGreaterThan(0);
      expect(score.scopeRisk.score).toBeLessThan(1);
      expect(score.scopeRisk.rationale).toContain("Moderate scope");
    });
  });

  describe("flaky tests", () => {
    it("reduces regression risk score", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 100, output: 50, total: 150 },
          wallTimeMs: 1000,
          costUsd: 0.50,
          flakeRate: 0.5,
        },
        evaluations: [{
          testResults: [{ name: "test1", passed: true, duration: 10, message: "ok" }],
          policyChecks: [],
          confidenceScore: 1,
        }],
        artifacts: [{ id: createArtifactId("a1"), diffs: [], logs: [], testOutputs: [], reports: [] }],
        actions: [{
          id: createActionId("a_flake"),
          toolCalls: [],
          fileEdits: [{ path: "src/a.ts", diff: "+code", timestamp: "2025-01-01T00:00:00.000Z" }],
          commands: [],
          timestamp: "2025-01-01T00:00:00.000Z",
        }],
      });

      const score = computeScore(run);
      expect(score.regressionRisk.score).toBe(0.5);
      expect(score.regressionRisk.rationale).toContain("Flake rate");
    });
  });
});
