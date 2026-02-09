import { getDb, type AgentOpsDb } from "@agentops/db";

let _db: AgentOpsDb | null = null;

export function db(): AgentOpsDb {
  if (!_db) {
    _db = getDb(process.env.AGENTOPS_DB_PATH);
  }
  return _db;
}
