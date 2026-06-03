import type {
  RunId,
  SessionId,
  Action,
  Artifact,
  Metrics,
  Agent,
  Environment,
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

export interface ReportMetricsRequest {
  readonly tokenUsage?: Metrics["tokenUsage"];
  readonly wallTimeMs?: number;
  readonly costUsd?: number;
  readonly flakeRate?: number;
}

export interface CheckPolicyRequest {
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>;
  readonly cumulativeCostUsd?: number;
  readonly branch?: string;
  readonly editedFiles?: ReadonlyArray<string>;
}

export interface CompleteRunRequest {
  readonly result?: string;
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

export interface CompleteRunResponse {
  readonly runId: RunId;
  readonly score: ScoreCard;
  readonly recommendation: MergeRecommendation;
  readonly summary: SessionSummary;
}

export interface FailRunResponse {
  readonly ok: true;
}
