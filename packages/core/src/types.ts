// ─── Branded ID types ────────────────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type RunId = Brand<string, "RunId">;
export type PolicyId = Brand<string, "PolicyId">;
export type AgentId = Brand<string, "AgentId">;
export type ActionId = Brand<string, "ActionId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type DecisionId = Brand<string, "DecisionId">;

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
  readonly createdAt: string;
  readonly updatedAt: string;
}
