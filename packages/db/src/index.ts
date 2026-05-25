// Connection
export { getDb } from "./connection.js";
export type { AgentOpsDb } from "./connection.js";

// Schema
export {
  runs,
  policies,
  policyResults,
  runMetrics,
  jobs,
  sessions,
  events,
  locks,
  users,
  apiTokens,
  authSessions,
  deviceCodes,
  webhooks,
  webhookDeliveries,
} from "./schema.js";

// Auth
export type { User, ApiToken, AuthSession, DeviceCode } from "./auth.js";
export {
  hashPassword,
  verifyPassword,
  generateApiToken,
  hashApiToken,
  countUsers,
  insertUser,
  getUserByEmail,
  getUserById,
  getUserWithPasswordByEmail,
  listUsers,
  setUserPassword,
  issueApiToken,
  getUserByRawApiToken,
  listApiTokensForUser,
  listAllApiTokens,
  getApiTokenById,
  revokeApiToken,
  createAuthSession,
  getUserBySessionId,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  createDeviceCode,
  getDeviceCodeByUserCode,
  getDeviceCodeByDeviceCode,
  approveDeviceCode,
  consumeApprovedDeviceCode,
  denyDeviceCode,
  deleteExpiredDeviceCodes,
} from "./auth.js";

// Run repository
export { insertRun, getRun, listRuns, updateRun, getRunMetrics, searchRuns, countRuns, getDistinctRepos, getDistinctBranches, updateRunSummary, getRunSummary, listRunsWithSummaries, deleteOldRuns, countRunsOlderThan, vacuum, countRunsWithoutUser, reassignRunsWithoutUser, countRunsByRepo, remapRunRepo } from "./runs.js";
export type { DeleteOldRunsResult } from "./runs.js";
export type { SearchRunsFilters, RunWithSummary } from "./runs.js";

// Policy repository
export { insertPolicy, insertPolicyResult, listPolicies, getPolicyResults, getPolicy, updatePolicy, deletePolicy, getPolicyStats, getPolicyResultsForPolicy } from "./policies.js";

// Audit log (Phase C)
export {
  insertAuditLog,
  listAuditLogs,
  countAuditLogs,
} from "./audit.js";
export type { AuditLogEntry, InsertAuditLogArgs, ListAuditLogsFilters } from "./audit.js";

// Job repository (WS1)
export { insertJob, getJob, listJobs, updateJob, countJobsByRepo, countJobsActive, getQueuedJobs } from "./jobs.js";

// Session repository (WS2)
export { insertSession, getSession, listSessions, updateSession, getActiveSessions, countActiveSessions, getStaleSessions } from "./sessions.js";

// Event repository (WS3)
export { insertEvent, getEvent, listEvents, countEvents, getEventsBySource, getRecentEvents } from "./events.js";

// Lock repository (WS4)
export { insertLock, getLock, listLocks, updateLock, getActiveLocks, getActiveLocksForHolder, releaseLocksForHolder, releaseExpiredLocks } from "./locks.js";

// Seed
export { seed } from "./seed.js";

// Starter policies (curated minimal policy set for new installs)
export {
  STARTER_POLICIES,
  loadStarterPolicies,
} from "./starter-policies.js";
export type { LoadStarterPoliciesResult } from "./starter-policies.js";

// Per-user budgets (Feature A)
export {
  getBudget,
  listBudgets,
  upsertBudget,
  deleteBudget,
  markThresholdFired,
} from "./budgets.js";
export type { UserBudget, BudgetPeriod } from "./budgets.js";

// Webhooks
export {
  insertWebhook,
  getWebhook,
  listWebhooks,
  listEnabledWebhooksForEvent,
  updateWebhook,
  deleteWebhook,
  insertWebhookDelivery,
  listWebhookDeliveries,
} from "./webhooks.js";
export type { Webhook, WebhookDelivery } from "./webhooks.js";
