// Structured JSON logger for the dashboard process.
//
// Hand-rolled instead of pulling in pino/winston so it works uniformly
// across Node runtime (route handlers) and Edge runtime (proxy.ts), and so
// there's nothing to keep in sync between workspaces.
//
// Output is JSON-per-line to stdout (debug/info) or stderr (warn/error).
// Docker captures both via the json-file log driver.
//
// Toggle verbosity with the LOG_LEVEL env var: debug | info | warn | error.
// Default: info.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevelOrdinal(): number {
  const raw =
    typeof process !== "undefined" && process.env
      ? process.env["LOG_LEVEL"] ?? "info"
      : "info";
  const normalized = raw.toLowerCase() as LogLevel;
  return LEVEL_ORDER[normalized] ?? LEVEL_ORDER.info;
}

export interface LogFields {
  readonly msg: string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly err?: string;
  readonly [k: string]: unknown;
}

function emit(level: LogLevel, fields: LogFields): void {
  if (LEVEL_ORDER[level] < currentLevelOrdinal()) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...fields,
  };
  // Stderr for warn/error so it's easy to filter; both are captured by
  // Docker either way.
  const line = JSON.stringify(entry);
  if (level === "warn" || level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
}

export const log: Logger = {
  debug: (f) => emit("debug", f),
  info: (f) => emit("info", f),
  warn: (f) => emit("warn", f),
  error: (f) => emit("error", f),
};

/**
 * Returns a Logger that automatically includes the request's id in every
 * log line. Route handlers should call this once at the top:
 *
 *   const rlog = requestLog(req);
 *   rlog.info({ msg: "fetched_runs", count: runs.length });
 */
export function requestLog(req: { headers: { get(name: string): string | null } }): Logger {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  return {
    debug: (f) => emit("debug", requestId ? { ...f, requestId } : f),
    info: (f) => emit("info", requestId ? { ...f, requestId } : f),
    warn: (f) => emit("warn", requestId ? { ...f, requestId } : f),
    error: (f) => emit("error", requestId ? { ...f, requestId } : f),
  };
}

/** Convenience: pull the id out of a request for use in error responses. */
export function getRequestId(req: { headers: { get(name: string): string | null } }): string | undefined {
  return req.headers.get("x-request-id") ?? undefined;
}

// Bring NextResponse in here so route handlers can do a single import
// when they want the standard internalError() shape.
import { NextResponse, type NextRequest } from "next/server";

/**
 * Drop-in replacement for the `catch (error) { console.error(...); return
 * NextResponse.json({ error: "Internal server error" }, ...) }` pattern.
 * Logs a structured server-side entry (with stack) and returns a
 * client-safe response that includes the requestId so the user can quote
 * it back to the operator.
 */
export function internalError(
  req: NextRequest,
  err: unknown,
  route: string,
): NextResponse {
  const rid = getRequestId(req);
  emit("error", {
    msg: "internal_error",
    route,
    ...(rid ? { requestId: rid } : {}),
    err: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  });
  return NextResponse.json(
    rid
      ? { error: "Internal server error", requestId: rid }
      : { error: "Internal server error" },
    { status: 500 },
  );
}
