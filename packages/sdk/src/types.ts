import type {
  RunId,
  SessionId,
  Action,
  Artifact,
  Metrics,
  Agent,
  Environment,
  Evaluation,
  Goal,
  ScoreCard,
  MergeRecommendation,
  SessionSummary,
} from "@agentops/core";

// ─── Client Configuration ───────────────────────────────────────────────────

export interface ClientConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeout?: number;
}

// ─── Request Types ──────────────────────────────────────────────────────────

export interface CreateSessionRequest {
  readonly agentId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface StartRunRequest {
  readonly goal: Goal;
  readonly agents: ReadonlyArray<Agent>;
  readonly environment: Environment;
  readonly sessionId?: SessionId;
}

export interface ReportActionRequest {
  readonly toolCalls?: Action["toolCalls"];
  readonly fileEdits?: Action["fileEdits"];
  readonly commands?: Action["commands"];
}

export interface ReportArtifactRequest {
  readonly diffs?: Artifact["diffs"];
  readonly logs?: Artifact["logs"];
  readonly testOutputs?: Artifact["testOutputs"];
  readonly reports?: Artifact["reports"];
}

// Partial-update semantics: every field is optional, and the server MERGES
// each report into the run's stored metrics — an omitted field preserves the
// previously reported value (it is never reset to zero).
export interface ReportMetricsRequest {
  readonly tokenUsage?: Metrics["tokenUsage"];
  readonly wallTimeMs?: number;
  readonly costUsd?: number;
  readonly flakeRate?: number;
  /** Which API backend served the traffic ("anthropic" | "bedrock"). */
  readonly backend?: Metrics["backend"];
  /** Per-model cost in USD, keyed by raw model id (Bedrock ids stay namespaced). */
  readonly byModel?: Metrics["byModel"];
}

export interface CheckPolicyRequest {
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>;
  readonly cumulativeCostUsd?: number;
  readonly branch?: string;
  readonly editedFiles?: ReadonlyArray<string>;
}

// Mirrors what /api/sdk/runs/[id]/complete actually consumes: the evaluation
// (test results, policy checks, confidence) plus any final artifacts to
// append. Without testResults the scorer has nothing to grade — correctness
// reads "not scored" and mutating runs can reach Merge with no tests run.
export interface CompleteRunRequest {
  /**
   * @deprecated The server has never read this field; it is silently
   * dropped. Report outcome data via testResults / policyChecks /
   * confidenceScore instead. Kept only so existing callers keep compiling.
   */
  readonly result?: string;
  /** Test outcomes for the run — these drive the correctness score. */
  readonly testResults?: Evaluation["testResults"];
  /** Client-side policy check outcomes to record on the evaluation. */
  readonly policyChecks?: Evaluation["policyChecks"];
  /** Agent self-reported confidence, 0-1. Defaults to 0 server-side. */
  readonly confidenceScore?: number;
  /** Final artifacts to append to the run before scoring. */
  readonly artifacts?: ReadonlyArray<Artifact>;
}

export interface FailRunRequest {
  readonly error: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────
//
// These mirror EXACTLY what the inbound /api/sdk/* route handlers return.
// Keep them in lockstep with those routes (see sdk-contract.test.ts, which
// drives the real handlers and asserts the shapes match).

export interface CreateSessionResponse {
  readonly sessionId: SessionId;
  readonly status: string;
}

export interface StartRunResponse {
  readonly runId: RunId;
  readonly status: string;
}

export interface ReportActionResponse {
  readonly runId: RunId;
  readonly actionId: string;
}

export interface ReportArtifactResponse {
  readonly runId: RunId;
  readonly artifactId: string;
}

export interface ReportMetricsResponse {
  readonly runId: RunId;
}

export interface PolicyViolation {
  readonly policy: string;
  readonly message: string;
  readonly severity?: string;
}

export interface CheckPolicyResponse {
  readonly decision: "allow" | "block";
  readonly reason?: string;
  readonly violations: ReadonlyArray<PolicyViolation>;
  readonly warnings: ReadonlyArray<PolicyViolation>;
}

export interface HeartbeatResponse {
  readonly ok: true;
  readonly commands: ReadonlyArray<unknown>;
}

export interface TerminateSessionResponse {
  readonly status: string;
}

export interface CompleteRunResponse {
  readonly runId: RunId;
  readonly score: ScoreCard;
  readonly recommendation: MergeRecommendation;
  readonly summary: SessionSummary;
}

export interface FailRunResponse {
  readonly ok: true;
}
