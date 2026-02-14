import type {
  Run,
  RunId,
  Session,
  SessionId,
  Action,
  Artifact,
  Metrics,
  Agent,
  Environment,
  Goal,
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
  readonly type: string;
  readonly path?: string;
  readonly description?: string;
}

export interface CompleteRunRequest {
  readonly result?: string;
}

export interface FailRunRequest {
  readonly error: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────

export interface CreateSessionResponse {
  readonly session: Session;
}

export interface StartRunResponse {
  readonly run: Run;
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

export interface CheckPolicyResponse {
  readonly permit: boolean;
  readonly violations: ReadonlyArray<{
    readonly policy: string;
    readonly message: string;
  }>;
}

export interface HeartbeatResponse {
  readonly sessionId: SessionId;
  readonly status: string;
}

export interface CompleteRunResponse {
  readonly run: Run;
}

export interface FailRunResponse {
  readonly run: Run;
}
