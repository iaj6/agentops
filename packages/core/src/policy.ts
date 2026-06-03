import type { PolicyId, Run } from "./types.js";

// ─── Policy types ────────────────────────────────────────────────────────────

export enum PolicyType {
  PathRestriction = "pathRestriction",
  FileLimitCount = "fileLimitCount",
  TestEnforcement = "testEnforcement",
  RiskyOpFlag = "riskyOpFlag",
  SecretDetection = "secretDetection",
  BranchProtection = "branchProtection",
  ToolRestriction = "toolRestriction",
  CostCeiling = "costCeiling",
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
    case PolicyType.ToolRestriction:
    case PolicyType.CostCeiling:
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
  | BranchProtectionConfig
  | ToolRestrictionConfig
  | CostCeilingConfig;

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

export interface ToolRestrictionConfig {
  readonly type: PolicyType.ToolRestriction;
  readonly blockedTools?: ReadonlyArray<string>;
  readonly allowedTools?: ReadonlyArray<string>;
}

export interface CostCeilingConfig {
  readonly type: PolicyType.CostCeiling;
  readonly maxUsd: number;
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

/**
 * Compile regex patterns, silently dropping any that don't compile. Used at
 * evaluation time so one malformed pattern can't throw and abort the whole
 * policy run (which would 500 the SDK route and, in the local hook's
 * fail-open default, silently disable enforcement). Write-time validation
 * (`findInvalidRegexPatterns`) keeps bad patterns from being persisted in the
 * first place, so a skip here only ever affects pre-validation legacy rows.
 */
export function compileRegexPatterns(
  patterns: ReadonlyArray<string>,
): Array<{ source: string; re: RegExp }> {
  const compiled: Array<{ source: string; re: RegExp }> = [];
  for (const p of patterns) {
    try {
      compiled.push({ source: p, re: new RegExp(p) });
    } catch {
      // Invalid pattern — skip. Prevented at write time; see above.
    }
  }
  return compiled;
}

/**
 * Return the patterns that fail to compile (empty = all valid). The API layer
 * calls this when a SecretDetection policy is created/updated and rejects the
 * request with 400 if anything is invalid.
 */
export function findInvalidRegexPatterns(
  patterns: ReadonlyArray<string>,
): string[] {
  const invalid: string[] = [];
  for (const p of patterns) {
    try {
      new RegExp(p);
    } catch {
      invalid.push(p);
    }
  }
  return invalid;
}

function evaluateSecretDetection(run: Run, policy: Policy, config: SecretDetectionConfig): PolicyResult {
  const compiledPatterns = compileRegexPatterns(config.patterns);
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

function evaluateToolRestriction(run: Run, policy: Policy, config: ToolRestrictionConfig): PolicyResult {
  const toolNames = run.actions.flatMap((a) => a.toolCalls.map((tc) => tc.name));
  const violations: string[] = [];

  if (config.allowedTools) {
    const allowed = new Set(config.allowedTools);
    for (const name of toolNames) {
      if (!allowed.has(name)) {
        violations.push(name);
      }
    }
  } else if (config.blockedTools) {
    const blocked = new Set(config.blockedTools);
    for (const name of toolNames) {
      if (blocked.has(name)) {
        violations.push(name);
      }
    }
  }

  const unique = [...new Set(violations)];
  return {
    passed: unique.length === 0,
    policy,
    message:
      unique.length === 0
        ? "No restricted tools were used"
        : `Restricted tools used: ${unique.join(", ")}`,
    details: { violations: unique },
  };
}

function evaluateCostCeiling(run: Run, policy: Policy, config: CostCeilingConfig): PolicyResult {
  const cost = run.metrics.costUsd;
  return {
    passed: cost <= config.maxUsd,
    policy,
    message:
      cost <= config.maxUsd
        ? `Cost $${cost.toFixed(2)} is within ceiling of $${config.maxUsd.toFixed(2)}`
        : `Cost $${cost.toFixed(2)} exceeds ceiling of $${config.maxUsd.toFixed(2)}`,
    details: { costUsd: cost, maxUsd: config.maxUsd },
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
    case PolicyType.ToolRestriction:
      return evaluateToolRestriction(run, policy, config);
    case PolicyType.CostCeiling:
      return evaluateCostCeiling(run, policy, config);
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

// ─── Pre-tool guard evaluation ──────────────────────────────────────────────
//
// Evaluates Guard policies against a *pending* tool invocation (before the
// tool actually runs). Used by:
//   - the local hook (transcript on disk, direct DB)
//   - the SDK server route /api/sdk/policy/check (HTTP, multi-user)
// One source of truth so behavior cannot drift between modes.

export interface ToolInvocation {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
}

export interface GuardContext {
  readonly editedFiles?: ReadonlySet<string>;
  readonly branch?: string;
  readonly cumulativeCostUsd?: number;
}

export interface PolicyViolation {
  readonly policy: string;
  readonly message: string;
  readonly severity: string;
}

// Truncate user-supplied strings before they appear in violation messages.
// Violation messages flow to stdout where Claude Code surfaces them in the
// terminal and CI logs frequently capture the output. Without truncation,
// full file paths and the bash command that matched a SecretDetection
// pattern (incl. the secret itself) would leak.
function summarizePath(p: string): string {
  // Show last two segments at most; that's enough context for the user to
  // know what they tripped on without echoing the full filesystem location.
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}

function summarizeCommand(cmd: string): string {
  return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
}

export function evaluatePreToolPolicies(
  invocation: ToolInvocation,
  activePolicies: ReadonlyArray<Policy & { enabled: boolean }>,
  context?: GuardContext,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const toolName = invocation.toolName;
  const toolInput = invocation.toolInput;

  // Known policy types for skipping deprecated/unknown types
  const knownTypes = new Set(Object.values(PolicyType) as string[]);

  for (const policy of activePolicies) {
    if (!policy.enabled) continue;
    if (!knownTypes.has(policy.config.type as string)) continue;

    if (
      policy.config.type === PolicyType.RiskyOpFlag &&
      toolName === "Bash" &&
      typeof toolInput["command"] === "string"
    ) {
      const cmd = toolInput["command"] as string;
      const flagged = policy.config.riskyPatterns.filter((pattern) =>
        cmd.includes(pattern),
      );
      if (flagged.length > 0) {
        violations.push({
          policy: policy.name,
          message: `Risky operation detected: ${flagged.join(", ")} in command "${summarizeCommand(cmd)}"`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.PathRestriction &&
      (toolName === "Edit" || toolName === "Write") &&
      typeof toolInput["file_path"] === "string"
    ) {
      const filePath = toolInput["file_path"] as string;
      const blocked = policy.config.blockedPaths.filter((p) =>
        filePath.startsWith(p),
      );
      if (blocked.length > 0) {
        violations.push({
          policy: policy.name,
          message: `Path restriction violated: ${summarizePath(filePath)} matches blocked path(s): ${blocked.join(", ")}`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.FileLimitCount &&
      (toolName === "Edit" || toolName === "Write") &&
      typeof toolInput["file_path"] === "string"
    ) {
      const filePath = toolInput["file_path"] as string;
      const config = policy.config as FileLimitCountConfig;
      const currentFiles = context?.editedFiles ?? new Set<string>();
      if (!currentFiles.has(filePath) && currentFiles.size >= config.maxFiles) {
        violations.push({
          policy: policy.name,
          message: `File limit exceeded: editing "${summarizePath(filePath)}" would be file ${currentFiles.size + 1}, limit is ${config.maxFiles}`,
          severity: policy.severity,
        });
      }
    }

    if (
      policy.config.type === PolicyType.SecretDetection &&
      (toolName === "Write" || toolName === "Edit")
    ) {
      const content = toolName === "Write"
        ? (typeof toolInput["content"] === "string" ? toolInput["content"] as string : "")
        : (typeof toolInput["new_string"] === "string" ? toolInput["new_string"] as string : "");

      if (content) {
        const config = policy.config as SecretDetectionConfig;
        const matched: string[] = [];
        for (const { source, re } of compileRegexPatterns(config.patterns)) {
          if (re.test(content)) matched.push(source);
        }
        if (matched.length > 0) {
          // Surface that a pattern matched, but never echo the matched
          // content — by definition that substring is the secret we caught.
          violations.push({
            policy: policy.name,
            message: `Secret pattern(s) detected: ${matched.length} match${matched.length === 1 ? "" : "es"}`,
            severity: policy.severity,
          });
        }
      }
    }

    if (
      policy.config.type === PolicyType.BranchProtection &&
      (toolName === "Write" || toolName === "Edit" || toolName === "Bash")
    ) {
      const branch = context?.branch;
      if (branch) {
        const config = policy.config as BranchProtectionConfig;
        if (config.protectedBranches.some((b) => b === branch)) {
          violations.push({
            policy: policy.name,
            message: `Mutation on protected branch "${branch}"`,
            severity: policy.severity,
          });
        }
      }
    }

    if (policy.config.type === PolicyType.ToolRestriction) {
      const config = policy.config as ToolRestrictionConfig;
      if (config.allowedTools) {
        if (!config.allowedTools.includes(toolName)) {
          violations.push({
            policy: policy.name,
            message: `Tool "${toolName}" is not in the allowed list`,
            severity: policy.severity,
          });
        }
      } else if (config.blockedTools) {
        if (config.blockedTools.includes(toolName)) {
          violations.push({
            policy: policy.name,
            message: `Tool "${toolName}" is blocked by policy`,
            severity: policy.severity,
          });
        }
      }
    }

    if (policy.config.type === PolicyType.CostCeiling) {
      const v = evaluateCostCeilingViolation(
        policy,
        policy.config as CostCeilingConfig,
        context?.cumulativeCostUsd ?? 0,
      );
      if (v) violations.push(v);
    }
  }

  return violations;
}

// ─── Turn-boundary policy evaluation ────────────────────────────────────────
//
// Pre-tool enforcement only fires when Claude is about to call a tool. Chat-
// only turns (long explanations, document analysis, no Edit/Bash) accumulate
// cost but never trigger PreToolUse — meaning cumulative budgets can be
// blown without enforcement.
//
// evaluateBudgetPolicies fills that gap. It's called from UserPromptSubmit
// (before the next user message is processed) and Stop (after each Claude
// response) to enforce budget caps regardless of whether the turn uses tools.
//
// Today only CostCeiling qualifies as a turn-boundary policy. Other policies
// that depend purely on cumulative state (e.g. session-wide file-count caps
// at completion) can be added here without changing callers.

// Validate inputs to avoid silent enforcement bypass. A NaN or negative
// cost (from a malformed transcript) would otherwise compare false and
// let the action through; a non-positive ceiling is a misconfig that
// should fail closed. Shared between evaluatePreToolPolicies and
// evaluateBudgetPolicies so the violation message format never drifts.
function evaluateCostCeilingViolation(
  policy: Policy & { enabled: boolean },
  config: CostCeilingConfig,
  cost: number,
): PolicyViolation | null {
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    !Number.isFinite(config.maxUsd) ||
    config.maxUsd <= 0
  ) {
    return {
      policy: policy.name,
      message: `Cost ceiling check failed: invalid cost ($${String(cost)}) or maxUsd ($${String(config.maxUsd)}). Failing closed.`,
      severity: policy.severity,
    };
  }
  if (cost >= config.maxUsd) {
    return {
      policy: policy.name,
      message: `Cost ceiling reached: $${cost.toFixed(2)} spent, limit is $${config.maxUsd.toFixed(2)}`,
      severity: policy.severity,
    };
  }
  return null;
}

export interface BudgetCheckContext {
  readonly cumulativeCostUsd: number;
}

export function evaluateBudgetPolicies(
  context: BudgetCheckContext,
  activePolicies: ReadonlyArray<Policy & { enabled: boolean }>,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const policy of activePolicies) {
    if (!policy.enabled) continue;
    if (policy.config.type === PolicyType.CostCeiling) {
      const v = evaluateCostCeilingViolation(
        policy,
        policy.config as CostCeilingConfig,
        context.cumulativeCostUsd,
      );
      if (v) violations.push(v);
    }
  }
  return violations;
}

export const DEFAULT_BUDGET_WARN_AT_PCT = 0.8;

/**
 * Return informational "approaching ceiling" warnings for CostCeiling
 * policies where cost is at or above `warnAtPct` of the ceiling but
 * has not yet reached it. Used by the Stop hook so a chat-heavy session
 * sees an early heads-up before the next prompt is hard-blocked.
 *
 * Always emits with severity=Warning regardless of the policy's own
 * severity — these are advisory, not enforcement. The breach itself
 * is evaluateBudgetPolicies's job; the two functions are independent
 * so a single policy can yield at most one of them (warning OR breach,
 * never both).
 *
 * `warnAtPct` should be a fraction in (0, 1). Out-of-range values
 * (≤0 or ≥1) suppress warnings entirely — there's no useful threshold.
 */
export function evaluateBudgetWarnings(
  context: BudgetCheckContext,
  activePolicies: ReadonlyArray<Policy & { enabled: boolean }>,
  warnAtPct: number = DEFAULT_BUDGET_WARN_AT_PCT,
): PolicyViolation[] {
  if (!Number.isFinite(warnAtPct) || warnAtPct <= 0 || warnAtPct >= 1) {
    return [];
  }
  const warnings: PolicyViolation[] = [];
  const cost = context.cumulativeCostUsd;
  if (!Number.isFinite(cost) || cost < 0) return [];

  for (const policy of activePolicies) {
    if (!policy.enabled) continue;
    if (policy.config.type !== PolicyType.CostCeiling) continue;
    const config = policy.config as CostCeilingConfig;
    if (!Number.isFinite(config.maxUsd) || config.maxUsd <= 0) continue;
    const pct = cost / config.maxUsd;
    if (pct >= warnAtPct && pct < 1) {
      const pctDisplay = Math.round(pct * 100);
      warnings.push({
        policy: policy.name,
        message: `Approaching ceiling: $${cost.toFixed(2)} of $${config.maxUsd.toFixed(2)} (${pctDisplay}%)`,
        severity: PolicySeverity.Warning,
      });
    }
  }
  return warnings;
}
