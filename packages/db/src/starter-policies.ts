// Curated starter policy set for new installs. Customers can load these
// from the CLI (`agentops init --seed-policies`) or via the dashboard
// "Load starter policies" button on an empty Policies page.
//
// IDs are stable (`pol_starter_*`) so loading twice is a no-op — the second
// call just reports them all as "skipped." That makes the flow safe for
// "I clicked the button and don't know if it worked the first time."
//
// These defaults are deliberately *conservative* — they catch obvious
// footguns (force-push, rm -rf, secrets in code, mutations on main) without
// blocking the actual coding workflow. Customers tune from there.

import {
  PolicyType,
  PolicySeverity,
  createPolicyId,
  type Policy,
} from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { getPolicy, insertPolicy } from "./policies.js";

export const STARTER_POLICIES: ReadonlyArray<Policy> = [
  {
    id: createPolicyId("pol_starter_cost_ceiling"),
    name: "Session cost ceiling ($25)",
    type: PolicyType.CostCeiling,
    config: {
      type: PolicyType.CostCeiling,
      maxUsd: 25,
    },
    severity: PolicySeverity.Error,
  },
  {
    id: createPolicyId("pol_starter_branch_protection"),
    name: "Protect main/master",
    type: PolicyType.BranchProtection,
    config: {
      type: PolicyType.BranchProtection,
      protectedBranches: ["main", "master"],
    },
    severity: PolicySeverity.Error,
  },
  {
    id: createPolicyId("pol_starter_secret_detection"),
    name: "Block secrets in source",
    type: PolicyType.SecretDetection,
    config: {
      type: PolicyType.SecretDetection,
      patterns: [
        // AWS access key IDs
        "AKIA[0-9A-Z]{16}",
        // PEM private keys
        "-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
        // Generic api_key / apikey / secret_key assignments
        "(?:api[_-]?key|apikey|secret[_-]?key)\\s*[:=]\\s*[\"'][A-Za-z0-9+/=_\\-]{20,}",
        // Generic bearer/token assignments
        "(?:token|bearer)\\s*[:=]\\s*[\"'][A-Za-z0-9._\\-]{20,}",
      ],
    },
    severity: PolicySeverity.Error,
  },
  {
    id: createPolicyId("pol_starter_risky_filesystem"),
    name: "Block destructive shell ops",
    type: PolicyType.RiskyOpFlag,
    config: {
      type: PolicyType.RiskyOpFlag,
      riskyPatterns: ["rm -rf", "sudo rm", "mkfs", "dd if="],
    },
    severity: PolicySeverity.Error,
  },
  {
    id: createPolicyId("pol_starter_risky_git"),
    name: "Block destructive git ops",
    type: PolicyType.RiskyOpFlag,
    config: {
      type: PolicyType.RiskyOpFlag,
      riskyPatterns: [
        "git push --force",
        "git push -f",
        "git reset --hard",
        "git clean -fd",
      ],
    },
    severity: PolicySeverity.Error,
  },
  {
    id: createPolicyId("pol_starter_tool_restriction"),
    name: "Block network fetch tools",
    type: PolicyType.ToolRestriction,
    config: {
      type: PolicyType.ToolRestriction,
      blockedTools: ["WebFetch", "WebSearch"],
    },
    severity: PolicySeverity.Warning,
  },
  {
    id: createPolicyId("pol_starter_file_limit"),
    name: "Cap files modified per session (50)",
    type: PolicyType.FileLimitCount,
    config: {
      type: PolicyType.FileLimitCount,
      maxFiles: 50,
    },
    severity: PolicySeverity.Warning,
  },
];

export interface LoadStarterPoliciesResult {
  readonly inserted: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

export function loadStarterPolicies(db: AgentOpsDb): LoadStarterPoliciesResult {
  const inserted: string[] = [];
  const skipped: string[] = [];
  const now = new Date().toISOString();

  for (const policy of STARTER_POLICIES) {
    if (getPolicy(db, policy.id)) {
      skipped.push(policy.name);
      continue;
    }
    insertPolicy(db, { ...policy, enabled: true, createdAt: now });
    inserted.push(policy.name);
  }

  return { inserted, skipped };
}
