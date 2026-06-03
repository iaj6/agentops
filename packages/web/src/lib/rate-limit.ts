import type { NextRequest } from "next/server";

// In-memory rate limiting for the dashboard. State lives in this single Node
// process and resets on restart — acceptable for the self-hosted, single-
// instance deployment (Caddy + one Next server). The clock is injectable so
// the windows/intervals are testable without real timers.

/** Client IP from forwarded headers (Caddy/nginx) with a stable fallback. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface LimitStatus {
  readonly limited: boolean;
  /** Seconds until the window expires (0 when not limited). */
  readonly retryAfterSec: number;
}

/**
 * Fixed-window failure counter with lockout. Call `recordFailure` on each
 * failed attempt and `reset` on success; `status` reports whether the key is
 * currently locked out (>= maxFailures within the window).
 */
export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; windowStartMs: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  status(key: string): LimitStatus {
    const e = this.entries.get(key);
    if (!e) return { limited: false, retryAfterSec: 0 };
    const elapsed = this.now() - e.windowStartMs;
    if (elapsed >= this.windowMs) {
      this.entries.delete(key);
      return { limited: false, retryAfterSec: 0 };
    }
    if (e.count >= this.maxFailures) {
      return { limited: true, retryAfterSec: Math.ceil((this.windowMs - elapsed) / 1000) };
    }
    return { limited: false, retryAfterSec: 0 };
  }

  recordFailure(key: string): void {
    const now = this.now();
    const e = this.entries.get(key);
    if (!e || now - e.windowStartMs >= this.windowMs) {
      this.entries.set(key, { count: 1, windowStartMs: now });
    } else {
      e.count += 1;
    }
    this.maybeSweep(now);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Test hook. */
  clear(): void {
    this.entries.clear();
  }

  private maybeSweep(now: number): void {
    if (this.entries.size < 2000) return;
    for (const [k, e] of this.entries) {
      if (now - e.windowStartMs >= this.windowMs) this.entries.delete(k);
    }
  }
}

/**
 * Minimum-interval limiter. `tooSoon(key)` returns true when the call lands
 * within `minIntervalMs` of the previous call for that key. Records the call
 * time on every invocation, so sustained fast polling stays throttled.
 */
export class IntervalLimiter {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tooSoon(key: string): boolean {
    const now = this.now();
    const prev = this.last.get(key);
    this.last.set(key, now);
    this.maybeSweep(now);
    if (prev === undefined) return false;
    return now - prev < this.minIntervalMs;
  }

  /** Test hook. */
  clear(): void {
    this.last.clear();
  }

  private maybeSweep(now: number): void {
    if (this.last.size < 5000) return;
    for (const [k, t] of this.last) {
      if (now - t >= this.minIntervalMs * 10) this.last.delete(k);
    }
  }
}

// ─── Shared singletons used by the auth routes ──────────────────────────────

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// Per (ip + email): stops targeted brute-force of one account. Per-IP keying
// means a failing attacker can't lock a victim out globally (no lockout DoS).
export const loginAccountLimiter = new FailureLimiter(5, FIFTEEN_MIN_MS);

// Per IP across all emails: bounds credential-stuffing from one source with a
// looser cap. Only that attacker's IP is ever blocked.
export const loginIpLimiter = new FailureLimiter(30, FIFTEEN_MIN_MS);

// Device-token poll cadence (RFC 8628 §3.5). The client is told interval=5s;
// enforce it server-side so a buggy/abusive poller gets `slow_down`.
export const devicePollLimiter = new IntervalLimiter(5000);
