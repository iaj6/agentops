import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// ─── Runs table ─────────────────────────────────────────────────────────────

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  goal: text("goal", { mode: "json" }).notNull(),
  agents: text("agents", { mode: "json" }).notNull(),
  environment: text("environment", { mode: "json" }).notNull(),
  repo: text("repo").notNull(),
  branch: text("branch").notNull(),
  actions: text("actions", { mode: "json" }).notNull(),
  artifacts: text("artifacts", { mode: "json" }).notNull(),
  metrics: text("metrics", { mode: "json" }).notNull(),
  evaluations: text("evaluations", { mode: "json" }).notNull(),
  decisions: text("decisions", { mode: "json" }).notNull(),
  github: text("github", { mode: "json" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Policies table ─────────────────────────────────────────────────────────

export const policies = sqliteTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: text("config", { mode: "json" }).notNull(),
  severity: text("severity").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

// ─── Policy results table ───────────────────────────────────────────────────

export const policyResults = sqliteTable("policy_results", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  policyId: text("policy_id")
    .notNull()
    .references(() => policies.id),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  message: text("message").notNull(),
  details: text("details", { mode: "json" }).notNull(),
  evaluatedAt: text("evaluated_at").notNull(),
});

// ─── Run metrics table ──────────────────────────────────────────────────────

export const runMetrics = sqliteTable("run_metrics", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  tokenUsage: text("token_usage", { mode: "json" }).notNull(),
  wallTimeMs: integer("wall_time_ms").notNull(),
  costCents: real("cost_cents").notNull(),
  flakeRate: real("flake_rate").notNull(),
  recordedAt: text("recorded_at").notNull(),
});

// ─── Jobs table ────────────────────────────────────────────────────────────

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  goal: text("goal", { mode: "json" }).notNull(),
  environment: text("environment", { mode: "json" }).notNull(),
  repo: text("repo").notNull(),
  branch: text("branch").notNull(),
  retryPolicy: text("retry_policy", { mode: "json" }).notNull(),
  concurrencyLimits: text("concurrency_limits", { mode: "json" }).notNull(),
  runIds: text("run_ids", { mode: "json" }).notNull(),
  sessionId: text("session_id"),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  queuedAt: text("queued_at").notNull(),
  dispatchedAt: text("dispatched_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Sessions table ────────────────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  agentId: text("agent_id").notNull(),
  currentRunId: text("current_run_id"),
  completedRunIds: text("completed_run_ids", { mode: "json" }).notNull(),
  resourceUsage: text("resource_usage", { mode: "json" }).notNull(),
  metadata: text("metadata", { mode: "json" }).notNull(),
  startedAt: text("started_at").notNull(),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  terminatedAt: text("terminated_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── Events table ──────────────────────────────────────────────────────────

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  sourceId: text("source_id").notNull(),
  timestamp: text("timestamp").notNull(),
});

// ─── Locks table ───────────────────────────────────────────────────────────

export const locks = sqliteTable("locks", {
  id: text("id").primaryKey(),
  lockType: text("lock_type").notNull(),
  resource: text("resource").notNull(),
  holderId: text("holder_id").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  released: integer("released", { mode: "boolean" }).notNull().default(false),
});
