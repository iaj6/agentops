import { describe, it, expect } from "vitest";
import {
  createRunId,
  createPolicyId,
  createAgentId,
  createActionId,
  createArtifactId,
  createDecisionId,
  RunStatus,
  AgentRole,
  DecisionType,
} from "../types.js";
import type { Run, RunId, PolicyId, AgentId, ActionId, ArtifactId, DecisionId as DecisionIdType } from "../types.js";

describe("Branded ID helpers", () => {
  it("createRunId returns a branded string", () => {
    const id = createRunId("run_123");
    expect(id).toBe("run_123");
    // TypeScript ensures at compile time that this is a RunId,
    // at runtime it is still a string
    expect(typeof id).toBe("string");
  });

  it("createPolicyId returns a branded string", () => {
    const id = createPolicyId("policy_abc");
    expect(id).toBe("policy_abc");
    expect(typeof id).toBe("string");
  });

  it("createAgentId returns a branded string", () => {
    const id = createAgentId("agent_1");
    expect(id).toBe("agent_1");
    expect(typeof id).toBe("string");
  });

  it("createActionId returns a branded string", () => {
    const id = createActionId("action_1");
    expect(id).toBe("action_1");
    expect(typeof id).toBe("string");
  });

  it("createArtifactId returns a branded string", () => {
    const id = createArtifactId("artifact_1");
    expect(id).toBe("artifact_1");
    expect(typeof id).toBe("string");
  });

  it("createDecisionId returns a branded string", () => {
    const id = createDecisionId("decision_1");
    expect(id).toBe("decision_1");
    expect(typeof id).toBe("string");
  });
});

describe("RunStatus enum", () => {
  it("has expected values", () => {
    expect(RunStatus.Pending).toBe("pending");
    expect(RunStatus.Running).toBe("running");
    expect(RunStatus.Completed).toBe("completed");
    expect(RunStatus.Failed).toBe("failed");
    expect(RunStatus.Blocked).toBe("blocked");
    expect(RunStatus.Cancelled).toBe("cancelled");
  });
});

describe("AgentRole enum", () => {
  it("has expected values", () => {
    expect(AgentRole.Lead).toBe("lead");
    expect(AgentRole.Implementer).toBe("implementer");
    expect(AgentRole.Reviewer).toBe("reviewer");
    expect(AgentRole.CI).toBe("ci");
    expect(AgentRole.Policy).toBe("policy");
  });
});

describe("DecisionType enum", () => {
  it("has expected values", () => {
    expect(DecisionType.Approval).toBe("approval");
    expect(DecisionType.Block).toBe("block");
    expect(DecisionType.Escalation).toBe("escalation");
  });
});

describe("Run interface (structural)", () => {
  it("can be constructed with all required fields", () => {
    const run: Run = {
      id: createRunId("run_1"),
      status: RunStatus.Pending,
      goal: {
        humanReadable: "Fix the bug",
        structured: { type: "task", description: "Fix the bug", parameters: {} },
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
        tokenUsage: { input: 0, output: 0, total: 0 },
        wallTimeMs: 0,
        costUsd: 0,
        flakeRate: 0,
      },
      evaluations: [],
      decisions: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    expect(run.id).toBe("run_1");
    expect(run.status).toBe(RunStatus.Pending);
    expect(run.goal.humanReadable).toBe("Fix the bug");
    expect(run.agents).toHaveLength(0);
    expect(run.actions).toHaveLength(0);
    expect(run.metrics.costUsd).toBe(0);
  });
});
