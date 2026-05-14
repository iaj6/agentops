// Per-session local outbox for SDK-mode hook events.
//
// When SdkOps fails a transient push (5xx, network error, anything that
// isn't an explicit 4xx) the event is appended to a per-Claude-Code-session
// JSONL file at ~/.agentops/outbox/<sanitized-session-id>.jsonl. On every
// subsequent SDK call (in the same session) we drain the file: re-issue
// each pending entry, drop on success, increment attempts on transient
// failure, drop on permanent failure (4xx — those won't succeed on retry).
//
// Cleanup: on a clean session-end the file is deleted. If the file still
// has entries after the final drain, we log loudly so the operator knows.
//
// The outbox is intentionally per-session-of-Claude-Code. Cross-session
// retry would require a global queue + concurrency control, which is more
// machinery than the trial needs. Document the limitation: if a session
// ends mid-outage and finalize fails, the run stays "running" until an
// admin intervenes.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OutboxEntry {
  readonly op: string;
  readonly args: ReadonlyArray<unknown>;
  readonly createdAt: string;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface DrainResult {
  /** Entries that posted successfully this drain. */
  readonly sent: number;
  /** Entries that remain in the outbox (transient failures kept for retry). */
  readonly remaining: number;
  /** Entries dropped because they were permanently failing (4xx etc). */
  readonly dropped: number;
}

export interface DrainHandlerResult {
  readonly ok: boolean;
  /** If true, drop the entry rather than retrying — used for permanent errors. */
  readonly permanent?: boolean;
  readonly error?: string;
}

function outboxDir(): string {
  return join(homedir(), ".agentops", "outbox");
}

export function outboxPath(claudeSessionId: string): string {
  // Match the state-file sanitization: any non-safe character becomes "_".
  const safe = claudeSessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(outboxDir(), `${safe}.jsonl`);
}

export class Outbox {
  constructor(public readonly path: string) {}

  /** Append an entry. Creates the directory + file on demand with mode 0700/0600. */
  enqueue(op: string, args: ReadonlyArray<unknown>, lastError?: string): void {
    const dir = outboxDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const entry: OutboxEntry = {
      op,
      args,
      createdAt: new Date().toISOString(),
      attempts: 0,
      ...(lastError ? { lastError } : {}),
    };
    appendFileSync(this.path, JSON.stringify(entry) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // Best-effort; not all filesystems support chmod.
    }
  }

  /** Number of entries currently queued. Best-effort, no locking. */
  size(): number {
    if (!existsSync(this.path)) return 0;
    try {
      const raw = readFileSync(this.path, "utf-8");
      return raw.split("\n").filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  /**
   * Walk every pending entry, calling the handler for each. Entries that
   * the handler reports as "ok" are removed. Entries with permanent=true
   * are dropped (they won't succeed on retry). Everything else stays in
   * the outbox with an incremented attempts counter.
   *
   * The rewrite is atomic via tmpfile + rename, so a crash mid-drain
   * leaves either the pre-drain file or the post-drain file — never a
   * truncated one.
   */
  async drain(
    handler: (entry: OutboxEntry) => Promise<DrainHandlerResult>,
  ): Promise<DrainResult> {
    if (!existsSync(this.path)) return { sent: 0, remaining: 0, dropped: 0 };

    let raw: string;
    try {
      raw = readFileSync(this.path, "utf-8");
    } catch {
      return { sent: 0, remaining: 0, dropped: 0 };
    }

    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const keep: OutboxEntry[] = [];
    let sent = 0;
    let dropped = 0;

    for (const line of lines) {
      let entry: OutboxEntry;
      try {
        entry = JSON.parse(line) as OutboxEntry;
      } catch {
        // Malformed line — drop it. (Better than infinite-looping on a
        // corruption.)
        dropped++;
        continue;
      }

      const result = await handler(entry);
      if (result.ok) {
        sent++;
        continue;
      }
      if (result.permanent) {
        dropped++;
        continue;
      }
      keep.push({
        ...entry,
        attempts: entry.attempts + 1,
        ...(result.error ? { lastError: result.error } : {}),
      });
    }

    if (keep.length === 0) {
      try {
        unlinkSync(this.path);
      } catch {
        // Ignore — file may have been removed concurrently.
      }
    } else {
      const tmp = this.path + ".tmp";
      const content = keep.map((e) => JSON.stringify(e)).join("\n") + "\n";
      writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
      renameSync(tmp, this.path);
    }

    return { sent, remaining: keep.length, dropped };
  }

  /** Drop the outbox file outright. Used on clean session-end. */
  clear(): void {
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        // Ignore.
      }
    }
  }
}
