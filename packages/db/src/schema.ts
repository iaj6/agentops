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
  summary: text("summary", { mode: "json" }),
  // userId set when the run came in via authenticated SDK call. NULL for
  // pre-auth runs and for direct-SQLite (local dev) runs.
  userId: text("user_id"),
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
  // userId set when the session was created by an authenticated SDK call.
  userId: text("user_id"),
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

// ─── Auth: users ───────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("member"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

// ─── Auth: API tokens (used by CLI hooks/SDK) ──────────────────────────────
// We store only SHA-256 of the bearer token. The raw token is returned to
// the user exactly once at issue time.

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
});

// ─── Auth: browser sessions (cookie-backed) ────────────────────────────────
// Named auth_sessions to avoid clashing with the existing agent-session table.

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

// ─── Auth: device authorization grant codes (RFC 8628) ─────────────────────

export const deviceCodes = sqliteTable("device_codes", {
  deviceCode: text("device_code").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  status: text("status").notNull().default("pending"),
  userId: text("user_id").references(() => users.id),
  tokenId: text("token_id").references(() => apiTokens.id),
  // Set when an approver approves the code. Cleared (consumed) when the
  // CLI's first successful /api/auth/device/token poll retrieves it.
  // Lives only between approval and first poll — typically seconds.
  pendingRawToken: text("pending_raw_token"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  approvedAt: text("approved_at"),
});

// ─── Outbound webhooks ─────────────────────────────────────────────────────
//
// Customers register URLs to receive HMAC-signed POSTs when events of
// interest occur (v1: policy.violated). The secret is stored plaintext —
// we need it to sign each outgoing request. Filesystem-level encryption
// on the SQLite file is the layer that protects it at rest. The API only
// echoes the last 4 characters back to the dashboard.

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  description: text("description"),
  secret: text("secret").notNull(),
  // JSON array of event types the webhook subscribes to. v1 only
  // recognises "policy.violated"; the column is JSON so we can add
  // more event types without a migration.
  events: text("events", { mode: "json" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  lastDeliveryAt: text("last_delivery_at"),
  lastDeliveryStatus: text("last_delivery_status"),
});

// One row per delivery attempt batch (success or terminal failure). Used
// for the dashboard's "Recent deliveries" view so customers can see why a
// webhook isn't firing the way they expect.

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id")
    .notNull()
    .references(() => webhooks.id),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  url: text("url").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  // "success" | "failed"
  status: text("status").notNull(),
  // Total attempts including the first try (1 = no retry, 2 = retried once)
  attempts: integer("attempts").notNull().default(0),
  responseStatus: integer("response_status"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at").notNull(),
});

// ─── Audit log table ────────────────────────────────────────────────────────
//
// One row per sensitive operation. userId is nullable because some
// actions are taken pre-auth (user.login from anonymous → resolves to
// the user on success) or by the system (cron-style cleanup jobs).
// `action` is a dotted string ("user.login", "policy.created", etc.).
// `targetType` + `targetId` reference the affected resource. `metadata`
// is a freeform JSON column for action-specific extra context (the new
// role on a permission change, the policy diff on an update, etc.).

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  userId: text("user_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  ip: text("ip"),
  metadata: text("metadata", { mode: "json" }),
});
