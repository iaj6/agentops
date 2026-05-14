// Structured logger for hook subprocesses + admin commands.
//
// Writes JSON-per-line to ~/.agentops/logs/hook.log (mode 0600). Rotates
// at 5 MB, keeps 3 generations. This is the post-hoc debug trail that
// `agentops doctor` reads when something went wrong three sessions ago.
//
// Distinct from process.stderr: stderr surfaces messages to Claude Code
// in real time (and is sometimes hidden by the user's terminal config).
// The log file always captures, with timestamps, structured fields, and
// process IDs. Callers that want a user-visible message *and* a trail
// should keep their existing stderr writes AND add a log call.
//
// Logging never throws. File-system errors are swallowed — we'd rather
// drop one log entry than crash a hook.

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Tune via AGENTOPS_LOG_LEVEL (preferred for the CLI) or LOG_LEVEL.
function currentLevelOrdinal(): number {
  const raw = (
    process.env["AGENTOPS_LOG_LEVEL"] ??
    process.env["LOG_LEVEL"] ??
    "info"
  ).toLowerCase();
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES = 3; // hook.log + hook.log.1 + hook.log.2

export function logFilePath(): string {
  return join(homedir(), ".agentops", "logs", "hook.log");
}

function ensureDir(): void {
  const dir = dirname(logFilePath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// Best-effort rotation. Two concurrent hook processes might both attempt
// to rotate; the rename calls are atomic on POSIX so the worst case is
// that one rename fails — the writes still go through.
function maybeRotate(): void {
  const path = logFilePath();
  if (!existsSync(path)) return;
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return;
  }
  if (size < MAX_BYTES) return;

  // Drop the oldest, slide the rest up by one.
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const src = `${path}.${i}`;
    if (i === MAX_FILES - 1) {
      try {
        if (existsSync(src)) unlinkSync(src);
      } catch {
        /* ignore */
      }
    } else {
      const dst = `${path}.${i + 1}`;
      try {
        if (existsSync(src)) renameSync(src, dst);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    renameSync(path, `${path}.1`);
  } catch {
    /* ignore */
  }
}

export interface LogFields {
  readonly msg: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly mode?: "sdk" | "local";
  readonly op?: string;
  readonly err?: string;
  readonly status?: number;
  readonly [k: string]: unknown;
}

function emit(level: LogLevel, fields: LogFields): void {
  if (LEVEL_ORDER[level] < currentLevelOrdinal()) return;
  try {
    ensureDir();
    maybeRotate();
    const entry = {
      ts: new Date().toISOString(),
      level,
      pid: process.pid,
      ...fields,
    };
    appendFileSync(logFilePath(), JSON.stringify(entry) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    try {
      chmodSync(logFilePath(), 0o600);
    } catch {
      // Best-effort — not all filesystems support chmod.
    }
  } catch {
    // Logging must never throw.
  }
}

export const log = {
  debug: (fields: LogFields) => emit("debug", fields),
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};
