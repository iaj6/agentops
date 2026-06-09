import type { Backend } from "./pricing.js";

// ─── Branded ID types ────────────────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type RunId = Brand<string, "RunId">;
export type PolicyId = Brand<string, "PolicyId">;
export type AgentId = Brand<string, "AgentId">;
export type ActionId = Brand<string, "ActionId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type DecisionId = Brand<string, "DecisionId">;
export type JobId = Brand<string, "JobId">;
export type SessionId = Brand<string, "SessionId">;
export type EventId = Brand<string, "EventId">;
export type LockId = Brand<string, "LockId">;

export function createRunId(value: string): RunId {
  return value as RunId;
}
export function createPolicyId(value: string): PolicyId {
  return value as PolicyId;
}
export function createAgentId(value: string): AgentId {
  return value as AgentId;
}
export function createActionId(value: string): ActionId {
  return value as ActionId;
}
export function createArtifactId(value: string): ArtifactId {
  return value as ArtifactId;
}
export function createDecisionId(value: string): DecisionId {
  return value as DecisionId;
}
export function createJobId(value: string): JobId {
  return value as JobId;
}
export function createSessionId(value: string): SessionId {
  return value as SessionId;
}
export function createEventId(value: string): EventId {
  return value as EventId;
}
export function createLockId(value: string): LockId {
  return value as LockId;
}

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum RunStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Blocked = "blocked",
  Cancelled = "cancelled",
}

export enum AgentRole {
  Lead = "lead",
  Implementer = "implementer",
  Reviewer = "reviewer",
  CI = "ci",
  Policy = "policy",
}

export enum JobStatus {
  Queued = "queued",
  Dispatched = "dispatched",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export enum JobPriority {
  Critical = "critical",
  High = "high",
  Normal = "normal",
  Low = "low",
}

export enum SessionStatus {
  Provisioning = "provisioning",
  Active = "active",
  Terminated = "terminated",
}

export enum EventCategory {
  Job = "job",
  Run = "run",
  Session = "session",
  Policy = "policy",
  Cost = "cost",
  Action = "action",
  Agent = "agent",
}

export enum LockType {
  Repo = "repo",
  Path = "path",
  Branch = "branch",
}

// ─── Goal ────────────────────────────────────────────────────────────────────

export interface Goal {
  readonly humanReadable: string;
  readonly structured: StructuredTask;
}

export interface StructuredTask {
  readonly type: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface Agent {
  readonly id: AgentId;
  readonly model: string;
  readonly role: AgentRole;
}

// ─── Environment ─────────────────────────────────────────────────────────────

export interface Environment {
  readonly repo: string;
  readonly branch: string;
  readonly permissions: ReadonlyArray<string>;
  readonly sandbox: SandboxConfig;
}

export interface SandboxConfig {
  readonly enabled: boolean;
  readonly isolationLevel: string;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface ToolCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly output: string;
  readonly timestamp: string;
}

export interface FileEdit {
  readonly path: string;
  readonly diff: string;
  readonly timestamp: string;
}

export interface Command {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timestamp: string;
}

export interface Action {
  readonly id: ActionId;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly fileEdits: ReadonlyArray<FileEdit>;
  readonly commands: ReadonlyArray<Command>;
  readonly timestamp: string;
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

export interface Artifact {
  readonly id: ArtifactId;
  readonly diffs: ReadonlyArray<string>;
  readonly logs: ReadonlyArray<string>;
  readonly testOutputs: ReadonlyArray<string>;
  readonly reports: ReadonlyArray<string>;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface Metrics {
  readonly tokenUsage: TokenUsage;
  readonly wallTimeMs: number;
  readonly costUsd: number;
  readonly flakeRate: number;
  // Which API backend served this run's traffic, as detected at cost-
  // computation time (CLAUDE_CODE_USE_BEDROCK). Optional: runs recorded
  // before backend capture landed have no value and read as unclassified.
  readonly backend?: Backend;
  // Per-model cost in USD, keyed by the raw model identifier from the
  // transcript (Bedrock IDs stay namespaced, e.g. "us.anthropic.…"). Optional
  // for the same backfill reason as backend.
  readonly byModel?: Readonly<Record<string, number>>;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export interface TestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly duration: number;
  readonly message: string;
}

export interface PolicyCheck {
  readonly policyId: PolicyId;
  readonly passed: boolean;
  readonly message: string;
}

export interface Evaluation {
  readonly testResults: ReadonlyArray<TestResult>;
  readonly policyChecks: ReadonlyArray<PolicyCheck>;
  readonly confidenceScore: number;
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export enum DecisionType {
  Approval = "approval",
  Block = "block",
  Escalation = "escalation",
}

export interface Decision {
  readonly id: DecisionId;
  readonly type: DecisionType;
  readonly actor: string;
  readonly reason: string;
  readonly timestamp: string;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

import type { GitHubInfo } from "./github.js";

export interface Run {
  readonly id: RunId;
  readonly status: RunStatus;
  readonly goal: Goal;
  readonly agents: ReadonlyArray<Agent>;
  readonly environment: Environment;
  readonly actions: ReadonlyArray<Action>;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly metrics: Metrics;
  readonly evaluations: ReadonlyArray<Evaluation>;
  readonly decisions: ReadonlyArray<Decision>;
  readonly github?: GitHubInfo;
  // userId is null for runs created before the auth migration (Phase 3)
  // or for runs created in local-only mode (no AGENTOPS_SERVER_URL).
  readonly userId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export interface ConcurrencyLimits {
  readonly perRepo: number;
  readonly perOrg: number;
  readonly global: number;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
}

export interface Job {
  readonly id: JobId;
  readonly status: JobStatus;
  readonly priority: JobPriority;
  readonly goal: Goal;
  readonly environment: Environment;
  readonly retryPolicy: RetryPolicy;
  readonly concurrencyLimits: ConcurrencyLimits;
  readonly runIds: ReadonlyArray<RunId>;
  readonly sessionId: SessionId | null;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly queuedAt: string;
  readonly dispatchedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface ResourceUsage {
  readonly memoryMb: number;
  readonly cpuPercent: number;
  readonly tokensBudgetRemaining: number;
  readonly costBudgetRemaining: number;
}

export interface Session {
  readonly id: SessionId;
  readonly status: SessionStatus;
  readonly agentId: AgentId;
  readonly currentRunId: RunId | null;
  readonly completedRunIds: ReadonlyArray<RunId>;
  readonly resourceUsage: ResourceUsage;
  readonly metadata: Record<string, unknown>;
  readonly startedAt: string;
  readonly lastHeartbeatAt: string;
  readonly terminatedAt: string | null;
  // userId is null for sessions created before the auth migration (Phase 3)
  // or for sessions created in local-only mode (no AGENTOPS_SERVER_URL).
  readonly userId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Event ───────────────────────────────────────────────────────────────────

export interface AgentEvent {
  readonly id: EventId;
  readonly category: EventCategory;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly sourceId: string;
  readonly timestamp: string;
}

// ─── Lock ────────────────────────────────────────────────────────────────────

export interface ResourceLock {
  readonly id: LockId;
  readonly lockType: LockType;
  readonly resource: string;
  readonly holderId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly released: boolean;
}
