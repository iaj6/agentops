// Types
export type {
  RunId,
  PolicyId,
  AgentId,
  ActionId,
  ArtifactId,
  DecisionId,
  JobId,
  SessionId,
  EventId,
  LockId,
  Goal,
  StructuredTask,
  Agent,
  Environment,
  SandboxConfig,
  ToolCall,
  FileEdit,
  Command,
  Action,
  Artifact,
  Metrics,
  TokenUsage,
  TestResult,
  PolicyCheck,
  Evaluation,
  Decision,
  Run,
  ConcurrencyLimits,
  RetryPolicy,
  Job,
  ResourceUsage,
  Session,
  AgentEvent,
  ResourceLock,
} from "./types.js";

export {
  RunStatus,
  AgentRole,
  DecisionType,
  JobStatus,
  JobPriority,
  SessionStatus,
  EventCategory,
  LockType,
  createRunId,
  createPolicyId,
  createAgentId,
  createActionId,
  createArtifactId,
  createDecisionId,
  createJobId,
  createSessionId,
  createEventId,
  createLockId,
} from "./types.js";

// Policy
export type {
  Policy,
  PolicyConfig,
  PathRestrictionConfig,
  FileLimitCountConfig,
  TestEnforcementConfig,
  RiskyOpFlagConfig,
  SecretDetectionConfig,
  BranchProtectionConfig,
  ToolRestrictionConfig,
  CostCeilingConfig,
  PolicyResult,
  ToolInvocation,
  GuardContext,
  PolicyViolation,
  BudgetCheckContext,
} from "./policy.js";

export {
  PolicyType,
  PolicySeverity,
  PolicyMode,
  PolicyEngine,
  getPolicyMode,
  runHasMutations,
  evaluatePreToolPolicies,
  evaluateBudgetPolicies,
} from "./policy.js";

// Scoring
export type { ScoreDimension, ScoreCard } from "./scoring.js";
export { MergeRecommendation, computeScore } from "./scoring.js";

// GitHub
export type {
  GitHubPR,
  GitHubIssue,
  GitHubCheck,
  GitHubLink,
  GitHubInfo,
} from "./github.js";

// Run builder
export {
  createRun,
  startRun,
  addAction,
  addArtifact,
  completeRun,
  failRun,
  blockRun,
  cancelRun,
  isStaleRun,
  RUN_STALE_THRESHOLD_MS,
} from "./run.js";

// Job builder (WS1)
export {
  createJob,
  dispatchJob,
  startJobRun,
  completeJob,
  failJob,
  cancelJob,
  retryJob,
} from "./job.js";
export type { CreateJobOptions } from "./job.js";

// Dispatcher (WS1)
export {
  evaluateDispatch,
  selectNextJob,
  matchSession,
} from "./dispatcher.js";
export type { DispatchConfig, DispatchDecision } from "./dispatcher.js";

// Session builder (WS2)
export {
  createSession,
  activateSession,
  assignRun,
  completeSessionRun,
  updateHeartbeat,
  updateResourceUsage,
  terminateSession,
  isStaleSession,
  STALE_THRESHOLD_MS,
} from "./session.js";

// Event system (WS3)
export { EVENT_TYPES, createEvent, EventBus } from "./events.js";
export type { EventType } from "./events.js";

// Per-user budgets (Feature A)
export {
  budgetPeriodStart,
  computeBudgetState,
  pickBudgetEvent,
} from "./budget.js";
export type {
  BudgetConfig,
  BudgetStatus,
  BudgetState,
} from "./budget.js";

// Coordination (WS4)
export type {
  ConflictCheckResult,
  BranchStrategy,
  PathPartition,
  PartitionStrategy,
} from "./coordination.js";

export {
  createLock,
  releaseLock,
  isLockExpired,
  isLockHeld,
  checkConflicts,
  generateWorkBranch,
  partitionByPath,
} from "./coordination.js";

// Orchestrator (Sprint 5)
export type { DispatchResult, ExecutionResult, OrchestratorDb } from "./orchestrator.js";

export {
  submitAndQueueJob,
  dispatchNextJob,
  startJobExecution,
  completeJobExecution,
  failJobExecution,
  terminateSessionGracefully,
  cleanupStaleSessions,
  cleanupExpiredLocks,
} from "./orchestrator.js";

// Agent tree (Sprint 12)
export type { AgentNode, AgentCommunication, AgentTimeline } from "./agent-tree.js";
export { buildAgentTimeline } from "./agent-tree.js";

// Summary (Sprint 9)
export type { SessionSummary } from "./summary.js";
export { generateSummary } from "./summary.js";

// Pricing
export type { ModelPricing, TokenUsageBlock, Backend } from "./pricing.js";
export {
  ANTHROPIC_PRICING,
  BEDROCK_PRICING,
  resolvePricing,
  computeCost,
  normalizeModelId,
} from "./pricing.js";
