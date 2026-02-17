import type { PolicyId, Run } from "./types.js";

// ─── Policy types ────────────────────────────────────────────────────────────

export enum PolicyType {
  PathRestriction = "pathRestriction",
  FileLimitCount = "fileLimitCount",
  TestEnforcement = "testEnforcement",
  RiskyOpFlag = "riskyOpFlag",
  SecretDetection = "secretDetection",
  BranchProtection = "branchProtection",
}

// ─── Policy mode (guard = real-time blocking, check = post-hoc evaluation) ──

export enum PolicyMode {
  Guard = "guard",
  Check = "check",
}

export function getPolicyMode(type: PolicyType): PolicyMode {
  switch (type) {
    case PolicyType.PathRestriction:
    case PolicyType.FileLimitCount:
    case PolicyType.RiskyOpFlag:
    case PolicyType.SecretDetection:
    case PolicyType.BranchProtection:
      return PolicyMode.Guard;
    case PolicyType.TestEnforcement:
      return PolicyMode.Check;
  }
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
  | TestEnforcementConfig
  | RiskyOpFlagConfig
  | SecretDetectionConfig
  | BranchProtectionConfig;

export interface PathRestrictionConfig {
  readonly type: PolicyType.PathRestriction;
  readonly blockedPaths: ReadonlyArray<string>;
}

export interface FileLimitCountConfig {
  readonly type: PolicyType.FileLimitCount;
  readonly maxFiles: number;
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

export interface SecretDetectionConfig {
  readonly type: PolicyType.SecretDetection;
  readonly patterns: ReadonlyArray<string>;
}

export interface BranchProtectionConfig {
  readonly type: PolicyType.BranchProtection;
  readonly protectedBranches: ReadonlyArray<string>;
}

// ─── Policy result ───────────────────────────────────────────────────────────

export interface PolicyResult {
  readonly passed: boolean;
  readonly policy: Policy;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

// ─── Run mutation detection ──────────────────────────────────────────────────

/** Returns true if the run contains file edits or commands (i.e. is not read-only). */
export function runHasMutations(run: Run): boolean {
  return run.actions.some(
    (a) => a.fileEdits.length > 0 || a.commands.length > 0,
  );
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

function evaluateTestEnforcement(run: Run, policy: Policy, config: TestEnforcementConfig): PolicyResult {
  const allTests = run.evaluations.flatMap((e) => e.testResults);
  if (allTests.length === 0) {
    // Read-only sessions (no file edits or commands) don't require tests
    if (!runHasMutations(run)) {
      return {
        passed: true,
        policy,
        message: "No code changes — tests not required",
        details: { testCount: 0, readOnlySession: true },
      };
    }
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

function evaluateSecretDetection(run: Run, policy: Policy, config: SecretDetectionConfig): PolicyResult {
  const compiledPatterns = config.patterns.map((p) => ({ source: p, re: new RegExp(p) }));
  const matched: string[] = [];

  for (const action of run.actions) {
    for (const edit of action.fileEdits) {
      for (const { source, re } of compiledPatterns) {
        if (re.test(edit.diff)) {
          matched.push(`Pattern "${source}" matched in file edit: ${edit.path}`);
        }
      }
    }
    for (const cmd of action.commands) {
      for (const { source, re } of compiledPatterns) {
        if (re.test(cmd.stdout)) {
          matched.push(`Pattern "${source}" matched in command output`);
        }
      }
    }
  }

  return {
    passed: matched.length === 0,
    policy,
    message:
      matched.length === 0
        ? "No secrets detected"
        : `Secrets detected: ${matched.join("; ")}`,
    details: { matched },
  };
}

function evaluateBranchProtection(run: Run, policy: Policy, config: BranchProtectionConfig): PolicyResult {
  const branch = run.environment.branch;
  const isProtected = config.protectedBranches.some((b) => b === branch);

  if (!isProtected) {
    return {
      passed: true,
      policy,
      message: `Branch "${branch}" is not protected`,
      details: { branch, protectedBranches: config.protectedBranches },
    };
  }

  const hasEdits = run.actions.some((a) => a.fileEdits.length > 0);
  const hasCommands = run.actions.some((a) => a.commands.length > 0);

  if (!hasEdits && !hasCommands) {
    return {
      passed: true,
      policy,
      message: `On protected branch "${branch}" but no mutations detected`,
      details: { branch, protectedBranches: config.protectedBranches },
    };
  }

  return {
    passed: false,
    policy,
    message: `Mutations on protected branch "${branch}"`,
    details: { branch, protectedBranches: config.protectedBranches },
  };
}

function evaluatePolicy(run: Run, policy: Policy): PolicyResult {
  const config = policy.config;
  switch (config.type) {
    case PolicyType.PathRestriction:
      return evaluatePathRestriction(run, policy, config);
    case PolicyType.FileLimitCount:
      return evaluateFileLimitCount(run, policy, config);
    case PolicyType.TestEnforcement:
      return evaluateTestEnforcement(run, policy, config);
    case PolicyType.RiskyOpFlag:
      return evaluateRiskyOpFlag(run, policy, config);
    case PolicyType.SecretDetection:
      return evaluateSecretDetection(run, policy, config);
    case PolicyType.BranchProtection:
      return evaluateBranchProtection(run, policy, config);
    default:
      return {
        passed: true,
        policy,
        message: `Skipped: unknown policy type "${(config as Record<string, unknown>).type}"`,
        details: { skipped: true },
      };
  }
}

export class PolicyEngine {
  evaluate(run: Run, policies: ReadonlyArray<Policy>): ReadonlyArray<PolicyResult> {
    return policies.map((policy) => evaluatePolicy(run, policy));
  }
}
