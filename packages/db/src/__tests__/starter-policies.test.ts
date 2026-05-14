import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import { listPolicies, deletePolicy } from "../policies.js";
import {
  STARTER_POLICIES,
  loadStarterPolicies,
} from "../starter-policies.js";
import { PolicyType } from "@agentops/core";

describe("loadStarterPolicies", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("installs all starter policies on a fresh DB", () => {
    const result = loadStarterPolicies(db);

    expect(result.inserted).toHaveLength(STARTER_POLICIES.length);
    expect(result.skipped).toHaveLength(0);

    const stored = listPolicies(db);
    expect(stored).toHaveLength(STARTER_POLICIES.length);
  });

  it("is idempotent: second call skips all", () => {
    loadStarterPolicies(db);
    const second = loadStarterPolicies(db);

    expect(second.inserted).toHaveLength(0);
    expect(second.skipped).toHaveLength(STARTER_POLICIES.length);

    // Still only one of each in the DB.
    const stored = listPolicies(db);
    expect(stored).toHaveLength(STARTER_POLICIES.length);
  });

  it("only fills gaps when some starters are already present", () => {
    loadStarterPolicies(db);

    // Delete one starter and re-load — should only re-insert the missing one
    const before = listPolicies(db);
    const costCeiling = before.find((p) => p.type === PolicyType.CostCeiling);
    expect(costCeiling).toBeDefined();
    deletePolicy(db, costCeiling!.id);

    const partial = listPolicies(db);
    expect(partial).toHaveLength(STARTER_POLICIES.length - 1);

    const result = loadStarterPolicies(db);
    expect(result.inserted).toHaveLength(1);
    expect(result.skipped).toHaveLength(STARTER_POLICIES.length - 1);
  });

  it("starter set covers the seven trial-readiness policy types", () => {
    const types = new Set(STARTER_POLICIES.map((p) => p.type));
    expect(types).toContain(PolicyType.CostCeiling);
    expect(types).toContain(PolicyType.BranchProtection);
    expect(types).toContain(PolicyType.SecretDetection);
    expect(types).toContain(PolicyType.RiskyOpFlag);
    expect(types).toContain(PolicyType.ToolRestriction);
    expect(types).toContain(PolicyType.FileLimitCount);
  });

  it("all starter policies are enabled after install", () => {
    loadStarterPolicies(db);
    const stored = listPolicies(db);
    for (const p of stored) {
      expect(p.enabled).toBe(true);
    }
  });
});
