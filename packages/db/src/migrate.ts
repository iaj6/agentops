import type Database from "better-sqlite3";

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

  // Add github column to existing runs tables (safe to run multiple times)
  try {
    sqlite.exec(`ALTER TABLE runs ADD COLUMN github TEXT`);
  } catch {
    // Column already exists - ignore
  }

  // ─── Orchestration tables ──────────────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      goal TEXT NOT NULL,
      environment TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      retry_policy TEXT NOT NULL,
      concurrency_limits TEXT NOT NULL,
      run_ids TEXT NOT NULL,
      session_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      queued_at TEXT NOT NULL,
      dispatched_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
    CREATE INDEX IF NOT EXISTS idx_jobs_repo ON jobs(repo);
    CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_queued_at ON jobs(queued_at);

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

    CREATE TABLE IF NOT EXISTS locks (
      id TEXT PRIMARY KEY,
      lock_type TEXT NOT NULL,
      resource TEXT NOT NULL,
      holder_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_locks_resource ON locks(resource);
    CREATE INDEX IF NOT EXISTS idx_locks_holder_id ON locks(holder_id);
    CREATE INDEX IF NOT EXISTS idx_locks_released ON locks(released);
    CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON locks(expires_at);
  `);
}
