import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import { seed } from "../seed.js";
import { listRuns } from "../runs.js";
import { listPolicies } from "../policies.js";
import { RunStatus } from "@agentops/core";

describe("seed", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("returns correct counts for runs, policies, and policy results", async () => {
    const counts = await seed(db);

    expect(counts.runs).toBe(50);
    expect(counts.policies).toBe(9);
    expect(counts.policyResults).toBeGreaterThan(0);
  });

  it("populates the runs table with 50 runs", async () => {
    await seed(db);

    const runs = listRuns(db);
    expect(runs).toHaveLength(50);
  });

  it("populates the policies table with 9 policies", async () => {
    await seed(db);

    const policies = listPolicies(db);
    expect(policies).toHaveLength(9);
  });

  it("creates runs with a mix of statuses", async () => {
    await seed(db);

    const runs = listRuns(db);
    const statuses = new Set(runs.map((r) => r.status));

    expect(statuses.has(RunStatus.Completed)).toBe(true);
    expect(statuses.has(RunStatus.Running)).toBe(true);
    expect(statuses.has(RunStatus.Failed)).toBe(true);
    expect(statuses.has(RunStatus.Blocked)).toBe(true);
    expect(statuses.has(RunStatus.Cancelled)).toBe(true);
  });

  it("creates runs with valid goal data", async () => {
    await seed(db);

    const runs = listRuns(db);
    for (const run of runs) {
      expect(run.goal.humanReadable).toBeTruthy();
      expect(run.goal.structured.type).toBeTruthy();
      expect(run.goal.structured.description).toBeTruthy();
    }
  });

  it("creates runs with environment data including repo and branch", async () => {
    await seed(db);

    const runs = listRuns(db);
    for (const run of runs) {
      expect(run.environment.repo).toBeTruthy();
      expect(run.environment.branch).toBeTruthy();
    }
  });

  it("creates runs with at least one agent each", async () => {
    await seed(db);

    const runs = listRuns(db);
    for (const run of runs) {
      expect(run.agents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("creates runs with realistic metrics (wallTime > 0, cost = 0)", async () => {
    await seed(db);

    const runs = listRuns(db);
    for (const run of runs) {
      expect(run.metrics.costUsd).toBe(0);
      expect(run.metrics.wallTimeMs).toBeGreaterThan(0);
      expect(run.metrics.tokenUsage.total).toBe(0);
    }
  });

  it("creates policies with all enabled", async () => {
    await seed(db);

    const policies = listPolicies(db);
    for (const policy of policies) {
      expect(policy.enabled).toBe(true);
    }
  });

  it("is idempotent when run on a fresh database", async () => {
    const first = await seed(db);
    // Running seed on a second fresh DB should give the same shape
    const db2 = getDb(":memory:");
    const second = await seed(db2);

    expect(first.runs).toBe(second.runs);
    expect(first.policies).toBe(second.policies);
  });
});
