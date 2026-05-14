import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import * as schema from "./schema.js";
import { migrate } from "./migrate.js";

export type AgentOpsDb = ReturnType<typeof drizzle<typeof schema>>;

const DEFAULT_DB_PATH = resolve(homedir(), ".agentops", "agentops.db");

export function getDb(dbPath?: string): AgentOpsDb {
  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;

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
