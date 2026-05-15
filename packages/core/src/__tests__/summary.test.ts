import { describe, it, expect } from "vitest";
import { generateSummary } from "../summary.js";
import type { Run, Metrics } from "../types.js";
import { RunStatus, createRunId, createActionId, createArtifactId, createPolicyId } from "../types.js";
import type { PolicyResult } from "../policy.js";
import { PolicyType, PolicySeverity } from "../policy.js";
import { MergeRecommendation } from "../scoring.js";
import type { ScoreCard } from "../scoring.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: createRunId("run_summary_test"),
    status: RunStatus.Completed,
    goal: {
      humanReadable: "Fix auth bug",
      structured: { type: "bugfix", description: "Fix auth bug", parameters: {} },
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
      tokenUsage: { input: 5000, output: 2000, total: 7000 },
      wallTimeMs: 30000,
      costUsd: 1.2,
      flakeRate: 0,
    },
    evaluations: [],
    decisions: [],
    createdAt: "2025-06-01T10:00:00.000Z",
    updatedAt: "2025-06-01T10:00:30.000Z",
    ...overrides,
  };
}

function makeScoreCard(overrides: Partial<ScoreCard> = {}): ScoreCard {
  return {
    correctness: { score: 1, rationale: "All tests pass" },
    regressionRisk: { score: 0.9, rationale: "Low risk" },
    scopeRisk: { score: 0.8, rationale: "Small scope" },
    policyCompliance: { score: 1, rationale: "All policies pass" },
    unknowns: { score: 1, rationale: "Full evidence" },
    mergeRecommendation: MergeRecommendation.Merge,
    ...overrides,
  };
}

describe("generateSummary", () => {
  describe("complete successful run", () => {
    it("generates summary with all fields populated", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [{ name: "read_file", input: {}, output: "content", timestamp: "2025-06-01T10:00:01.000Z" }],
            fileEdits: [
              { path: "src/auth.ts", diff: "+import foo\n-import bar", timestamp: "2025-06-01T10:00:02.000Z" },
              { path: "src/login.ts", diff: "+new code\n-old code", timestamp: "2025-06-01T10:00:03.000Z" },
            ],
            commands: [
              { command: "npm test", exitCode: 0, stdout: "ok", stderr: "", timestamp: "2025-06-01T10:00:04.000Z" },
              { command: "npm run build", exitCode: 0, stdout: "ok", stderr: "", timestamp: "2025-06-01T10:00:05.000Z" },
            ],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
        evaluations: [
          {
            testResults: [
              { name: "auth test", passed: true, duration: 10, message: "ok" },
              { name: "login test", passed: true, duration: 20, message: "ok" },
            ],
            policyChecks: [],
            confidenceScore: 1,
          },
        ],
        artifacts: [{ id: createArtifactId("art1"), diffs: ["diff"], logs: ["log"], testOutputs: ["out"], reports: [] }],
      });

      const policyResults: PolicyResult[] = [
        {
          passed: true,
          policy: {
            id: createPolicyId("p1"),
            name: "File limit",
            type: PolicyType.FileLimitCount,
            config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
            severity: PolicySeverity.Error,
          },
          message: "File count within limit",
          details: {},
        },
      ];

      const score = makeScoreCard();

      const summary = generateSummary(run, run.metrics, policyResults, score);

      expect(summary.runId).toBe(run.id);
      expect(summary.goal).toBe("Fix auth bug");
      expect(summary.outcome).toBe("success");
      expect(summary.duration.wallTimeMs).toBe(30000);
      expect(summary.duration.startedAt).toBe("2025-06-01T10:00:00.000Z");
      expect(summary.duration.completedAt).toBe("2025-06-01T10:00:30.000Z");
      expect(summary.filesChanged.total).toBe(2);
      expect(summary.commandsRun.total).toBe(2);
      expect(summary.commandsRun.highlights).toContain("npm test");
      expect(summary.commandsRun.highlights).toContain("npm run build");
      expect(summary.cost).not.toBeNull();
      expect(summary.cost!.totalUsd).toBe(1.2);
      expect(summary.cost!.inputTokens).toBe(5000);
      expect(summary.cost!.outputTokens).toBe(2000);
      expect(summary.actions.total).toBe(5); // 2 edits + 2 commands + 1 tool call
      expect(summary.actions.byType["FileEdit"]).toBe(2);
      expect(summary.actions.byType["CommandRun"]).toBe(2);
      expect(summary.actions.byType["ToolCall"]).toBe(1);
      expect(summary.policyResults.total).toBe(1);
      expect(summary.policyResults.passed).toBe(1);
      expect(summary.policyResults.violated).toBe(0);
      expect(summary.score).not.toBeNull();
      expect(summary.score!.recommendation).toBe("merge");
      expect(summary.score!.correctness).toBe(1);
      expect(summary.generatedAt).toBeTruthy();
    });
  });

  describe("failed run", () => {
    it("maps status to failure outcome", () => {
      const run = makeRun({ status: RunStatus.Failed });
      const summary = generateSummary(run);
      expect(summary.outcome).toBe("failure");
    });
  });

  describe("blocked run", () => {
    it("maps status to blocked outcome", () => {
      const run = makeRun({ status: RunStatus.Blocked });
      const summary = generateSummary(run);
      expect(summary.outcome).toBe("blocked");
    });
  });

  describe("cancelled run", () => {
    it("maps status to cancelled outcome", () => {
      const run = makeRun({ status: RunStatus.Cancelled });
      const summary = generateSummary(run);
      expect(summary.outcome).toBe("cancelled");
    });
  });

  describe("running run", () => {
    it("maps pending/running status to running outcome", () => {
      const run1 = makeRun({ status: RunStatus.Running });
      expect(generateSummary(run1).outcome).toBe("running");

      const run2 = makeRun({ status: RunStatus.Pending });
      expect(generateSummary(run2).outcome).toBe("running");
    });
  });

  describe("run with no metrics", () => {
    it("returns null cost when costUsd is zero", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallTimeMs: 0,
          costUsd: 0,
          flakeRate: 0,
        },
      });
      const summary = generateSummary(run);
      expect(summary.cost).toBeNull();
    });

    it("uses explicit metrics parameter when provided", () => {
      const run = makeRun();
      const overrideMetrics: Metrics = {
        tokenUsage: { input: 999, output: 111, total: 1110 },
        wallTimeMs: 5000,
        costUsd: 2.5,
        flakeRate: 0,
      };
      const summary = generateSummary(run, overrideMetrics);
      expect(summary.cost!.totalUsd).toBe(2.5);
      expect(summary.cost!.inputTokens).toBe(999);
      expect(summary.duration.wallTimeMs).toBe(5000);
    });
  });

  describe("run with no policy results", () => {
    it("returns zero-count policy results", () => {
      const run = makeRun();
      const summary = generateSummary(run);
      expect(summary.policyResults.total).toBe(0);
      expect(summary.policyResults.passed).toBe(0);
      expect(summary.policyResults.violated).toBe(0);
      expect(summary.policyResults.violations).toEqual([]);
    });
  });

  describe("run with policy violations", () => {
    it("captures violation messages", () => {
      const run = makeRun();
      const policyResults: PolicyResult[] = [
        {
          passed: true,
          policy: {
            id: createPolicyId("p1"),
            name: "File limit",
            type: PolicyType.FileLimitCount,
            config: { type: PolicyType.FileLimitCount, maxFiles: 20 },
            severity: PolicySeverity.Error,
          },
          message: "OK",
          details: {},
        },
        {
          passed: false,
          policy: {
            id: createPolicyId("p2"),
            name: "Path",
            type: PolicyType.PathRestriction,
            config: { type: PolicyType.PathRestriction, blockedPaths: [".env"] },
            severity: PolicySeverity.Error,
          },
          message: "Restricted path .env modified",
          details: {},
        },
      ];
      const summary = generateSummary(run, undefined, policyResults);
      expect(summary.policyResults.total).toBe(2);
      expect(summary.policyResults.passed).toBe(1);
      expect(summary.policyResults.violated).toBe(1);
      expect(summary.policyResults.violations).toEqual(["Restricted path .env modified"]);
    });
  });

  describe("run with no score", () => {
    it("returns null score when not provided", () => {
      const run = makeRun();
      const summary = generateSummary(run);
      expect(summary.score).toBeNull();
    });
  });

  describe("headline generation", () => {
    it("generates informative headline for standard run", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [
              { path: "src/a.ts", diff: "+code\n-old", timestamp: "2025-06-01T10:00:01.000Z" },
              { path: "src/b.ts", diff: "+code\n-old", timestamp: "2025-06-01T10:00:02.000Z" },
              { path: "src/c.ts", diff: "+code\n-old", timestamp: "2025-06-01T10:00:03.000Z" },
              { path: "src/d.ts", diff: "+code\n-old", timestamp: "2025-06-01T10:00:04.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
        evaluations: [
          {
            testResults: [
              { name: "t1", passed: true, duration: 5, message: "ok" },
              { name: "t2", passed: true, duration: 5, message: "ok" },
            ],
            policyChecks: [],
            confidenceScore: 1,
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.headline).toContain("Fix auth bug");
      expect(summary.headline).toContain("4 files");
      expect(summary.headline).toContain("tests pass");
      expect(summary.headline).toContain("$1.20");
      expect(summary.headline.length).toBeLessThanOrEqual(100);
    });

    it("truncates long goals in headline", () => {
      const run = makeRun({
        goal: {
          humanReadable: "Implement a comprehensive authentication system with OAuth2 support and MFA",
          structured: { type: "feature", description: "long", parameters: {} },
        },
      });

      const summary = generateSummary(run);
      // The goal part should be truncated to 40 chars
      expect(summary.headline.length).toBeLessThanOrEqual(100);
      expect(summary.headline).toContain("...");
    });

    it("shows 'no tests' when no test results", () => {
      const run = makeRun({ evaluations: [] });
      const summary = generateSummary(run);
      expect(summary.headline).toContain("no tests");
    });

    it("shows failing count when tests fail", () => {
      const run = makeRun({
        evaluations: [
          {
            testResults: [
              { name: "t1", passed: true, duration: 5, message: "ok" },
              { name: "t2", passed: false, duration: 5, message: "fail" },
              { name: "t3", passed: false, duration: 5, message: "fail" },
            ],
            policyChecks: [],
            confidenceScore: 0.33,
          },
        ],
      });
      const summary = generateSummary(run);
      expect(summary.headline).toContain("2/3 failing");
    });

    it("omits the cost segment from the headline when cost is zero", () => {
      // Before B2: headline contained "no cost", which read as "the
      // product doesn't track cost." Now the segment is dropped entirely
      // when no cost was recorded (and the dedicated Cost card carries
      // the signal on the run detail page).
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 0, output: 0, total: 0 },
          wallTimeMs: 1000,
          costUsd: 0,
          flakeRate: 0,
        },
      });
      const summary = generateSummary(run);
      expect(summary.headline).not.toContain("no cost");
      expect(summary.headline).not.toContain("$");
    });

    it("includes the cost segment when cost > 0", () => {
      const run = makeRun({
        metrics: {
          tokenUsage: { input: 100, output: 50, total: 150 },
          wallTimeMs: 1000,
          costUsd: 3.42,
          flakeRate: 0,
        },
      });
      const summary = generateSummary(run);
      expect(summary.headline).toContain("$3.42");
    });

    it("shows single file correctly", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [{ path: "src/index.ts", diff: "+code\n-old", timestamp: "2025-06-01T10:00:01.000Z" }],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });
      const summary = generateSummary(run);
      expect(summary.headline).toContain("1 file,");
    });
  });

  describe("file categorization", () => {
    it("categorizes created files (additions only)", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [
              { path: "src/new-file.ts", diff: "+export function foo() {}", timestamp: "2025-06-01T10:00:01.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.filesChanged.created).toContain("src/new-file.ts");
      expect(summary.filesChanged.modified).toHaveLength(0);
      expect(summary.filesChanged.deleted).toHaveLength(0);
    });

    it("categorizes deleted files (removals only)", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [
              { path: "src/old-file.ts", diff: "-export function foo() {}", timestamp: "2025-06-01T10:00:01.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.filesChanged.deleted).toContain("src/old-file.ts");
      expect(summary.filesChanged.created).toHaveLength(0);
      expect(summary.filesChanged.modified).toHaveLength(0);
    });

    it("categorizes modified files (both additions and removals)", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [
              { path: "src/existing.ts", diff: "+new line\n-old line", timestamp: "2025-06-01T10:00:01.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.filesChanged.modified).toContain("src/existing.ts");
      expect(summary.filesChanged.created).toHaveLength(0);
      expect(summary.filesChanged.deleted).toHaveLength(0);
    });

    it("deduplicates files across multiple actions", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [
              { path: "src/file.ts", diff: "+line1\n-old1", timestamp: "2025-06-01T10:00:01.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
          {
            id: createActionId("a2"),
            toolCalls: [],
            fileEdits: [
              { path: "src/file.ts", diff: "+line2\n-old2", timestamp: "2025-06-01T10:00:02.000Z" },
            ],
            commands: [],
            timestamp: "2025-06-01T10:00:02.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.filesChanged.total).toBe(1);
    });
  });

  describe("command highlights", () => {
    it("filters trivial commands", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [],
            commands: [
              { command: "cd src", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:01.000Z" },
              { command: "ls -la", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:02.000Z" },
              { command: "npm test", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:03.000Z" },
              { command: "pwd", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:04.000Z" },
              { command: "npm run build", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:05.000Z" },
            ],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.commandsRun.total).toBe(5);
      expect(summary.commandsRun.highlights).toEqual(["npm test", "npm run build"]);
      expect(summary.commandsRun.highlights).not.toContain("cd src");
      expect(summary.commandsRun.highlights).not.toContain("ls -la");
      expect(summary.commandsRun.highlights).not.toContain("pwd");
    });

    it("limits highlights to 5 entries", () => {
      const commands = Array.from({ length: 10 }, (_, i) => ({
        command: `npm run task-${i}`,
        exitCode: 0,
        stdout: "",
        stderr: "",
        timestamp: "2025-06-01T10:00:01.000Z",
      }));

      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [],
            fileEdits: [],
            commands,
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.commandsRun.total).toBe(10);
      expect(summary.commandsRun.highlights).toHaveLength(5);
    });
  });

  describe("action counting by type", () => {
    it("counts actions by type correctly", () => {
      const run = makeRun({
        actions: [
          {
            id: createActionId("a1"),
            toolCalls: [
              { name: "read", input: {}, output: "", timestamp: "2025-06-01T10:00:01.000Z" },
              { name: "write", input: {}, output: "", timestamp: "2025-06-01T10:00:02.000Z" },
            ],
            fileEdits: [
              { path: "a.ts", diff: "+code", timestamp: "2025-06-01T10:00:03.000Z" },
            ],
            commands: [
              { command: "npm test", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:04.000Z" },
              { command: "npm build", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:05.000Z" },
              { command: "npm lint", exitCode: 0, stdout: "", stderr: "", timestamp: "2025-06-01T10:00:06.000Z" },
            ],
            timestamp: "2025-06-01T10:00:01.000Z",
          },
        ],
      });

      const summary = generateSummary(run);
      expect(summary.actions.total).toBe(6);
      expect(summary.actions.byType["ToolCall"]).toBe(2);
      expect(summary.actions.byType["FileEdit"]).toBe(1);
      expect(summary.actions.byType["CommandRun"]).toBe(3);
    });

    it("returns zero counts for empty run", () => {
      const run = makeRun();
      const summary = generateSummary(run);
      expect(summary.actions.total).toBe(0);
      expect(summary.actions.byType).toEqual({});
    });
  });
});
