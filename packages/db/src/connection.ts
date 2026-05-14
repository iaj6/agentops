import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";

export type AgentOpsDb = ReturnType<typeof drizzle<typeof schema>>;

// Resolution precedence for the database path:
//   1. Explicit dbPath argument (e.g. `agentops --db-path ...`)
//   2. AGENTOPS_DB_PATH env var (Docker uses this to point at /data/agentops.db)
//   3. ~/.agentops/agentops.db default
function resolveDefaultPath(): string {
  const fromEnv = process.env["AGENTOPS_DB_PATH"]?.trim();
  if (fromEnv) return fromEnv;
  return resolve(homedir(), ".agentops", "agentops.db");
}

export function getDb(dbPath?: string): AgentOpsDb {
  const resolvedPath = dbPath ?? resolveDefaultPath();

  // Auto-create directory if needed (skip for in-memory)
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  // Run migrations on connect
  migrate(sqlite);

  return db;
}
