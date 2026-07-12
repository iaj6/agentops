// Client
export { AgentOpsClient, AgentOpsError, createClient } from "./client.js";

// Middleware
export { PolicyMiddleware, createMiddleware } from "./middleware.js";

// Types
export type {
  ClientConfig,
  CreateSessionRequest,
  CreateSessionResponse,
  StartRunRequest,
  StartRunResponse,
  ReportActionRequest,
  ReportActionResponse,
  ReportArtifactRequest,
  ReportArtifactResponse,
  ReportMetricsRequest,
  ReportMetricsResponse,
  CheckPolicyRequest,
  CheckPolicyResponse,
  PolicyViolation,
  HeartbeatResponse,
  TerminateSessionResponse,
  CompleteRunRequest,
  CompleteRunResponse,
  FailRunRequest,
  FailRunResponse,
} from "./types.js";

export type {
  PolicyCheckResult,
  MiddlewareResult,
} from "./middleware.js";
