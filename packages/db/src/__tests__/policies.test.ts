import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertPolicy, listPolicies } from "../policies.js";
import type { AgentOpsDb } from "../connection.js";
import { createPolicyId, PolicyType, PolicySeverity } from "@agentops/core";
import type { Policy } from "@agentops/core";

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
        name: "Cost ceiling",
        type: PolicyType.CostCeiling,
        config: { type: PolicyType.CostCeiling, maxCostUsd: 5.0 },
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
        type: PolicyType.CostCeiling,
        config: { type: PolicyType.CostCeiling, maxCostUsd: 1.0 },
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
});
