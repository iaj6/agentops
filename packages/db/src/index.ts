// Connection
export { getDb } from "./connection.js";
export type { AgentOpsDb } from "./connection.js";

// Schema
export { runs, policies, policyResults, runMetrics, jobs, sessions, events, locks } from "./schema.js";

// Run repository
export { insertRun, getRun, listRuns, updateRun, getRunMetrics, searchRuns, countRuns, getDistinctRepos, getDistinctBranches } from "./runs.js";
export type { SearchRunsFilters } from "./runs.js";

// Policy repository
export { insertPolicy, listPolicies, getPolicyResults, getPolicy, updatePolicy, getPolicyStats, getPolicyResultsForPolicy } from "./policies.js";

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
