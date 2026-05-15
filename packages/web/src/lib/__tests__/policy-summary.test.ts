import { describe, it, expect } from "vitest";
import { summarizePolicyConfig } from "@/lib/policy-summary";
import { PolicyType } from "@agentops/core";

describe("summarizePolicyConfig", () => {
  // PathRestriction
  describe("PathRestriction", () => {
    it("lists blocked paths when present", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.PathRestriction,
          blockedPaths: ["a", "b"],
        }),
      ).toBe("Block paths: a, b");
    });

    it("returns fallback when no blocked paths", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.PathRestriction,
          blockedPaths: [],
        }),
      ).toBe("No blocked paths");
    });
  });

  // FileLimitCount
  describe("FileLimitCount", () => {
    it("uses plural form for many files", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.FileLimitCount,
          maxFiles: 50,
        }),
      ).toBe("Max 50 files per session");
    });

    it("uses singular form for exactly 1 file", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.FileLimitCount,
          maxFiles: 1,
        }),
      ).toBe("Max 1 file per session");
    });
  });

  // TestEnforcement
  describe("TestEnforcement", () => {
    it("shows both require-passing and min-coverage", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.TestEnforcement,
          requirePassing: true,
          minCoverage: 80,
        }),
      ).toBe("tests must pass, min 80% coverage");
    });

    it("shows only require-passing when minCoverage is 0", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.TestEnforcement,
          requirePassing: true,
          minCoverage: 0,
        }),
      ).toBe("tests must pass");
    });

    it("returns No requirements when both flags are off", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.TestEnforcement,
          requirePassing: false,
          minCoverage: 0,
        }),
      ).toBe("No requirements");
    });
  });

  // RiskyOpFlag
  describe("RiskyOpFlag", () => {
    it("lists risky patterns when present", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.RiskyOpFlag,
          riskyPatterns: ["rm -rf", "sudo rm"],
        }),
      ).toBe("Block patterns: rm -rf, sudo rm");
    });

    it("returns No patterns when list is empty", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.RiskyOpFlag,
          riskyPatterns: [],
        }),
      ).toBe("No patterns");
    });
  });

  // SecretDetection
  describe("SecretDetection", () => {
    it("uses plural form for multiple patterns", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.SecretDetection,
          patterns: ["sk-", "ghp_", "AKIA", "-----BEGIN"],
        }),
      ).toBe("4 secret patterns");
    });

    it("uses singular form for exactly 1 pattern", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.SecretDetection,
          patterns: ["sk-"],
        }),
      ).toBe("1 secret pattern");
    });

    it("returns No patterns when list is empty", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.SecretDetection,
          patterns: [],
        }),
      ).toBe("No patterns");
    });
  });

  // BranchProtection
  describe("BranchProtection", () => {
    it("lists protected branches when present", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.BranchProtection,
          protectedBranches: ["main", "master"],
        }),
      ).toBe("Protect: main, master");
    });

    it("returns fallback when no protected branches", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.BranchProtection,
          protectedBranches: [],
        }),
      ).toBe("No protected branches");
    });
  });

  // ToolRestriction
  describe("ToolRestriction", () => {
    it("shows blocked tools when blockedTools is set", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.ToolRestriction,
          blockedTools: ["WebFetch"],
        }),
      ).toBe("Block tools: WebFetch");
    });

    it("shows allow-only when allowedTools is set (no blockedTools)", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.ToolRestriction,
          allowedTools: ["WebSearch"],
        }),
      ).toBe("Allow only: WebSearch");
    });

    it("returns No tool restrictions when both lists are empty/absent", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.ToolRestriction,
        }),
      ).toBe("No tool restrictions");
    });
  });

  // CostCeiling
  describe("CostCeiling", () => {
    it("formats small dollar amounts", () => {
      expect(
        summarizePolicyConfig({
          type: PolicyType.CostCeiling,
          maxUsd: 25,
        }),
      ).toBe("Max $25 per session");
    });

    it("formats large dollar amounts with toLocaleString separators", () => {
      const result = summarizePolicyConfig({
        type: PolicyType.CostCeiling,
        maxUsd: 1234,
      });
      // toLocaleString output is locale-dependent; just assert it contains 1234
      // and starts with the expected prefix/suffix structure.
      expect(result).toMatch(/^Max \$1[,.]?234 per session$/);
    });
  });
});
