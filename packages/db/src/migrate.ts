import type Database from "better-sqlite3";

/**
 * Run an additive `ALTER TABLE ... ADD COLUMN`, tolerating only the expected
 * "duplicate column name" error when the migration is re-run. Any other error
 * (I/O, lock, permission) is a real failure and is re-thrown loudly rather
 * than silently swallowed — otherwise a missing column surfaces much later as
 * a confusing "no such column" at query time.
 */
function addColumnIfMissing(sqlite: Database.Database, sql: string): void {
  try {
    sqlite.exec(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(msg)) throw err;
  }
}

/**
 * Programmatic schema migration. Creates tables if they don't exist.
 * Uses the schema definitions to generate CREATE TABLE IF NOT EXISTS statements.
 */
export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      goal TEXT NOT NULL,
      agents TEXT NOT NULL,
      environment TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      actions TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      metrics TEXT NOT NULL,
      evaluations TEXT NOT NULL,
      decisions TEXT NOT NULL,
      github TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_repo ON runs(repo);
    CREATE INDEX IF NOT EXISTS idx_runs_branch ON runs(branch);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at);

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      severity TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      policy_id TEXT NOT NULL REFERENCES policies(id),
      passed INTEGER NOT NULL,
      message TEXT NOT NULL,
      details TEXT NOT NULL,
      evaluated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_policy_results_run_id ON policy_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_policy_results_policy_id ON policy_results(policy_id);

    CREATE TABLE IF NOT EXISTS run_metrics (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      token_usage TEXT NOT NULL,
      wall_time_ms INTEGER NOT NULL,
      cost_cents REAL NOT NULL,
      flake_rate REAL NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_metrics_run_id ON run_metrics(run_id);
  `);

  // Add github + summary columns to existing runs tables (safe to re-run).
  addColumnIfMissing(sqlite, `ALTER TABLE runs ADD COLUMN github TEXT`);
  addColumnIfMissing(sqlite, `ALTER TABLE runs ADD COLUMN summary TEXT`);

  // ─── Orchestration tables ──────────────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      current_run_id TEXT,
      completed_run_ids TEXT NOT NULL,
      resource_usage TEXT NOT NULL,
      metadata TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      terminated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_current_run_id ON sessions(current_run_id);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      source_id TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_source_id ON events(source_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  `);

  // ─── Auth tables ──────────────────────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS device_codes (
      device_code TEXT PRIMARY KEY,
      user_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT REFERENCES users(id),
      token_id TEXT REFERENCES api_tokens(id),
      pending_raw_token TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes(user_code);
    CREATE INDEX IF NOT EXISTS idx_device_codes_status ON device_codes(status);
    CREATE INDEX IF NOT EXISTS idx_device_codes_expires_at ON device_codes(expires_at);
  `);

  // ─── Webhooks tables ──────────────────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      description TEXT,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_delivery_at TEXT,
      last_delivery_status TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id),
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      url TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      response_status INTEGER,
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
  `);

  // ─── Audit log table (Phase C) ───────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      ip TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  `);

  // ─── Per-user budgets (Feature A) ────────────────────────────────────────
  // Amount stored in cents to avoid floating-point rounding. Period is
  // either 'week' (Monday UTC start) or 'month' (day 1 UTC start). The
  // two last_*_at columns dedupe threshold-crossing events so we fire
  // at most once per (user, period, threshold).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_budgets (
      user_id TEXT PRIMARY KEY,
      amount_usd_cents INTEGER NOT NULL,
      period TEXT NOT NULL,
      warn_at_pct INTEGER NOT NULL DEFAULT 80,
      last_warn_at TEXT,
      last_breach_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Add pending_raw_token column to existing device_codes tables (safe to
  // run multiple times). Forward-additive migration for any pre-2.3 DBs.
  addColumnIfMissing(sqlite, `ALTER TABLE device_codes ADD COLUMN pending_raw_token TEXT`);

  // Add user_id column to runs/sessions for Phase 3 SDK scoping. Existing
  // rows get NULL — they remain visible but unattributed (admin can still
  // see them; member views filter them out). The indexes use IF NOT EXISTS
  // so they're already idempotent and need no error handling.
  addColumnIfMissing(sqlite, `ALTER TABLE runs ADD COLUMN user_id TEXT`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_runs_user_id ON runs(user_id)`);
  addColumnIfMissing(sqlite, `ALTER TABLE sessions ADD COLUMN user_id TEXT`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
}
