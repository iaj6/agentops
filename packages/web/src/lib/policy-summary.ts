import { PolicyType, type PolicyConfig } from "@agentops/core";

/**
 * Human-readable one-liner for a policy config. Used in the Policies list
 * cell to replace the raw JSON dump that was unreadable for non-developers
 * ({"type":"riskyOpFlag","riskyPatterns":["rm -rf",...]}).
 *
 * Returns a fallback ("Custom configuration") if a new policy type is
 * added without updating this switch.
 */
export function summarizePolicyConfig(config: PolicyConfig): string {
  switch (config.type) {
    case PolicyType.PathRestriction:
      return config.blockedPaths.length === 0
        ? "No blocked paths"
        : `Block paths: ${config.blockedPaths.join(", ")}`;
    case PolicyType.FileLimitCount:
      return `Max ${config.maxFiles} file${config.maxFiles === 1 ? "" : "s"} per session`;
    case PolicyType.TestEnforcement:
      // minCoverage was removed from the config: it was rendered here but
      // never enforced anywhere (no coverage data exists on a Run), so the
      // summary was claiming enforcement that couldn't happen.
      return config.requirePassing ? "tests must pass" : "No requirements";
    case PolicyType.RiskyOpFlag:
      return config.riskyPatterns.length === 0
        ? "No patterns"
        : `Block patterns: ${config.riskyPatterns.join(", ")}`;
    case PolicyType.SecretDetection:
      return config.patterns.length === 0
        ? "No patterns"
        : `${config.patterns.length} secret pattern${config.patterns.length === 1 ? "" : "s"}`;
    case PolicyType.BranchProtection:
      return config.protectedBranches.length === 0
        ? "No protected branches"
        : `Protect: ${config.protectedBranches.join(", ")}`;
    case PolicyType.ToolRestriction: {
      const blocked = config.blockedTools ?? [];
      const allowed = config.allowedTools ?? [];
      if (blocked.length > 0) return `Block tools: ${blocked.join(", ")}`;
      if (allowed.length > 0) return `Allow only: ${allowed.join(", ")}`;
      return "No tool restrictions";
    }
    case PolicyType.CostCeiling:
      return `Max $${config.maxUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} per session`;
  }
}
