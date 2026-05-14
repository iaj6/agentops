// Constants safe to import from edge-runtime contexts (middleware) — must
// not transitively pull in @agentops/db (which uses better-sqlite3 and is
// Node-only).

export const SESSION_COOKIE_NAME = "agentops_session";
