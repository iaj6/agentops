import type { PolicyId, Run } from "./types.js";

// ─── Policy types ────────────────────────────────────────────────────────────

export enum PolicyType {
  PathRestriction = "pathRestriction",
  FileLimitCount = "fileLimitCount",
  CostCeiling = "costCeiling",
  RequiredApproval = "requiredApproval",
  TestEnforcement = "testEnforcement",
  RiskyOpFlag = "riskyOpFlag",
}

export enum PolicySeverity {
  Error = "error",
  Warning = "warning",
  Info = "info",
}

export interface Policy {
  readonly id: PolicyId;
  readonly name: string;
  readonly type: PolicyType;
  readonly config: PolicyConfig;
  readonly severity: PolicySeverity;
}

export type PolicyConfig =
  | PathRestrictionConfig
  | FileLimitCountConfig
  | CostCeilingConfig
  | RequiredApprovalConfig
  | TestEnforcementConfig
  | RiskyOpFlagConfig;

export interface PathRestrictionConfig {
  readonly type: PolicyType.PathRestriction;
  readonly blockedPaths: ReadonlyArray<string>;
}

export interface FileLimitCountConfig {
  readonly type: PolicyType.FileLimitCount;
  readonly maxFiles: number;
}

export interface CostCeilingConfig {
  readonly type: PolicyType.CostCeiling;
  readonly maxCostUsd: number;
}

export interface RequiredApprovalConfig {
  readonly type: PolicyType.RequiredApproval;
  readonly approvers: ReadonlyArray<string>;
}

export interface TestEnforcementConfig {
  readonly type: PolicyType.TestEnforcement;
  readonly requirePassing: boolean;
  readonly minCoverage: number;
}

export interface RiskyOpFlagConfig {
  readonly type: PolicyType.RiskyOpFlag;
  readonly riskyPatterns: ReadonlyArray<string>;
}

// ─── Policy result ───────────────────────────────────────────────────────────

export interface PolicyResult {
  readonly passed: boolean;
  readonly policy: Policy;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

// ─── Policy engine ───────────────────────────────────────────────────────────

function evaluatePathRestriction(run: Run, policy: Policy, config: PathRestrictionConfig): PolicyResult {
  const editedPaths = run.actions.flatMap((a) =>
    a.fileEdits.map((e) => e.path)
  );
  const violations = editedPaths.filter((p) =>
    config.blockedPaths.some((blocked) => p.startsWith(blocked))
  );
  return {
    passed: violations.length === 0,
    policy,
    message:
      violations.length === 0
        ? "No restricted paths were modified"
        : `Restricted paths modified: ${violations.join(", ")}`,
    details: { violations },
  };
}

function evaluateFileLimitCount(run: Run, policy: Policy, config: FileLimitCountConfig): PolicyResult {
  const editedFiles = new Set(
    run.actions.flatMap((a) => a.fileEdits.map((e) => e.path))
  );
  const count = editedFiles.size;
  return {
    passed: count <= config.maxFiles,
    policy,
    message:
      count <= config.maxFiles
        ? `File count ${count} is within limit of ${config.maxFiles}`
        : `File count ${count} exceeds limit of ${config.maxFiles}`,
    details: { count, maxFiles: config.maxFiles },
  };
}

function evaluateCostCeiling(run: Run, policy: Policy, config: CostCeilingConfig): PolicyResult {
  const cost = run.metrics.costUsd;
  return {
    passed: cost <= config.maxCostUsd,
    policy,
    message:
      cost <= config.maxCostUsd
        ? `Cost $${cost.toFixed(2)} is within ceiling of $${config.maxCostUsd.toFixed(2)}`
        : `Cost $${cost.toFixed(2)} exceeds ceiling of $${config.maxCostUsd.toFixed(2)}`,
    details: { cost, maxCostUsd: config.maxCostUsd },
  };
}

function evaluateRequiredApproval(run: Run, policy: Policy, config: RequiredApprovalConfig): PolicyResult {
  const approvers = run.decisions
    .filter((d) => d.type === "approval")
    .map((d) => d.actor);
  const missingApprovers = config.approvers.filter(
    (a) => !approvers.includes(a)
  );
  return {
    passed: missingApprovers.length === 0,
    policy,
    message:
      missingApprovers.length === 0
        ? "All required approvals received"
        : `Missing approvals from: ${missingApprovers.join(", ")}`,
    details: { missingApprovers, receivedApprovers: approvers },
  };
}

function evaluateTestEnforcement(run: Run, policy: Policy, config: TestEnforcementConfig): PolicyResult {
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length === 0) {
    return {
      passed: !config.requirePassing,
      policy,
      message: config.requirePassing
        ? "No test results found but tests are required"
        : "No test results found",
      details: { testCount: 0 },
    };
  }
  const passing = allTests.filter((t) => t.passed).length;
  const total = allTests.length;
  const allPassing = passing === total;
  return {
    passed: !config.requirePassing || allPassing,
    policy,
    message: allPassing
      ? `All ${total} tests passing`
      : `${total - passing} of ${total} tests failing`,
    details: { passing, total },
  };
}

function evaluateRiskyOpFlag(run: Run, policy: Policy, config: RiskyOpFlagConfig): PolicyResult {
  const commands = run.actions.flatMap((a) => a.commands.map((c) => c.command));
  const flagged = commands.filter((cmd) =>
    config.riskyPatterns.some((pattern) => cmd.includes(pattern))
  );
  return {
    passed: flagged.length === 0,
    policy,
    message:
      flagged.length === 0
        ? "No risky operations detected"
        : `Risky operations detected: ${flagged.join(", ")}`,
    details: { flagged },
  };
}

function evaluatePolicy(run: Run, policy: Policy): PolicyResult {
  const config = policy.config;
  switch (config.type) {
    case PolicyType.PathRestriction:
      return evaluatePathRestriction(run, policy, config);
    case PolicyType.FileLimitCount:
      return evaluateFileLimitCount(run, policy, config);
    case PolicyType.CostCeiling:
      return evaluateCostCeiling(run, policy, config);
    case PolicyType.RequiredApproval:
      return evaluateRequiredApproval(run, policy, config);
    case PolicyType.TestEnforcement:
      return evaluateTestEnforcement(run, policy, config);
    case PolicyType.RiskyOpFlag:
      return evaluateRiskyOpFlag(run, policy, config);
  }
}

export class PolicyEngine {
  evaluate(run: Run, policies: ReadonlyArray<Policy>): ReadonlyArray<PolicyResult> {
    return policies.map((policy) => evaluatePolicy(run, policy));
  }
}
