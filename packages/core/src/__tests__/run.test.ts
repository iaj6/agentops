import { describe, it, expect } from "vitest";
import {
  createRun,
  startRun,
  addAction,
  addArtifact,
  completeRun,
  failRun,
  blockRun,
  cancelRun,
} from "../run.js";
import { RunStatus, DecisionType, createActionId, createArtifactId } from "../types.js";
import type { Action, Artifact, Evaluation, Run } from "../types.js";

const testGoal: Run["goal"] = {
  humanReadable: "Test goal",
  structured: { type: "task", description: "Test goal", parameters: {} },
};

const testEnv: Run["environment"] = {
  repo: "test/repo",
  branch: "main",
  permissions: [],
  sandbox: { enabled: false, isolationLevel: "none" },
};

describe("createRun", () => {
  it("produces a valid initial Run with Pending status", () => {
    const run = createRun(testGoal, testEnv);

    expect(run.id).toBeTruthy();
    expect(typeof run.id).toBe("string");
    expect(run.status).toBe(RunStatus.Pending);
    expect(run.goal).toEqual(testGoal);
    expect(run.environment).toEqual(testEnv);
    expect(run.agents).toEqual([]);
    expect(run.actions).toEqual([]);
    expect(run.artifacts).toEqual([]);
    expect(run.evaluations).toEqual([]);
    expect(run.decisions).toEqual([]);
    expect(run.metrics).toEqual({
      tokenUsage: { input: 0, output: 0, total: 0 },
      wallTimeMs: 0,
      costUsd: 0,
      flakeRate: 0,
    });
    expect(run.createdAt).toBeTruthy();
    expect(run.updatedAt).toBeTruthy();
  });

  it("generates unique IDs for different runs", () => {
    const run1 = createRun(testGoal, testEnv);
    const run2 = createRun(testGoal, testEnv);
    expect(run1.id).not.toBe(run2.id);
  });
});

describe("startRun", () => {
  it("sets status to Running", () => {
    const run = createRun(testGoal, testEnv);
    const started = startRun(run);

    expect(started.status).toBe(RunStatus.Running);
    expect(started.id).toBe(run.id);
    expect(started.goal).toEqual(run.goal);
  });
});

describe("addAction", () => {
  it("appends to actions array", () => {
    const run = createRun(testGoal, testEnv);

    const action: Action = {
      id: createActionId("action_1"),
      toolCalls: [],
      fileEdits: [],
      commands: [],
      timestamp: new Date().toISOString(),
    };

    const updated = addAction(run, action);

    expect(updated.actions).toHaveLength(1);
    expect(updated.actions[0]).toEqual(action);
    // Original is unchanged (immutable)
    expect(run.actions).toHaveLength(0);
  });

  it("accumulates multiple actions", () => {
    let run = createRun(testGoal, testEnv);

    for (let i = 0; i < 3; i++) {
      const action: Action = {
        id: createActionId(`action_${i}`),
        toolCalls: [],
        fileEdits: [],
        commands: [],
        timestamp: new Date().toISOString(),
      };
      run = addAction(run, action);
    }

    expect(run.actions).toHaveLength(3);
  });
});

describe("addArtifact", () => {
  it("appends to artifacts array", () => {
    const run = createRun(testGoal, testEnv);

    const artifact: Artifact = {
      id: createArtifactId("artifact_1"),
      diffs: ["diff content"],
      logs: ["log line"],
      testOutputs: [],
      reports: [],
    };

    const updated = addArtifact(run, artifact);
    expect(updated.artifacts).toHaveLength(1);
    expect(updated.artifacts[0]).toEqual(artifact);
    expect(run.artifacts).toHaveLength(0);
  });
});

describe("completeRun", () => {
  it("sets status to Completed and appends evaluation", () => {
    const run = startRun(createRun(testGoal, testEnv));

    const evaluation: Evaluation = {
      testResults: [
        { name: "test1", passed: true, duration: 100, message: "ok" },
      ],
      policyChecks: [],
      confidenceScore: 0.95,
    };

    const completed = completeRun(run, evaluation);

    expect(completed.status).toBe(RunStatus.Completed);
    expect(completed.evaluations).toHaveLength(1);
    expect(completed.evaluations[0]).toEqual(evaluation);
  });
});

describe("failRun", () => {
  it("sets status to Failed and adds a Block decision with the reason", () => {
    const run = startRun(createRun(testGoal, testEnv));
    const failed = failRun(run, "Tests failed");

    expect(failed.status).toBe(RunStatus.Failed);
    expect(failed.decisions).toHaveLength(1);
    expect(failed.decisions[0]!.type).toBe(DecisionType.Block);
    expect(failed.decisions[0]!.actor).toBe("system");
    expect(failed.decisions[0]!.reason).toBe("Tests failed");
  });
});

describe("blockRun", () => {
  it("sets status to Blocked and adds a Block decision", () => {
    const run = startRun(createRun(testGoal, testEnv));
    const blocked = blockRun(run, "reviewer", "Needs review");

    expect(blocked.status).toBe(RunStatus.Blocked);
    expect(blocked.decisions).toHaveLength(1);
    expect(blocked.decisions[0]!.actor).toBe("reviewer");
    expect(blocked.decisions[0]!.reason).toBe("Needs review");
  });
});

describe("cancelRun", () => {
  it("sets status to Cancelled", () => {
    const run = startRun(createRun(testGoal, testEnv));
    const cancelled = cancelRun(run);

    expect(cancelled.status).toBe(RunStatus.Cancelled);
  });
});
