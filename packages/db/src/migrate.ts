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
}
