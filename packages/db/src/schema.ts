import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
