import { describe, it, expect } from "vitest";
import { FailureLimiter, IntervalLimiter } from "@/lib/rate-limit";

// Controllable clock so window/interval behavior is deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("FailureLimiter", () => {
  it("allows until maxFailures is reached, then limits", () => {
    const c = clock();
    const lim = new FailureLimiter(3, 60_000, c.now);
    expect(lim.status("k").limited).toBe(false);
    lim.recordFailure("k");
    lim.recordFailure("k");
    expect(lim.status("k").limited).toBe(false); // 2 < 3
    lim.recordFailure("k");
    const s = lim.status("k"); // 3 >= 3, checked at the same instant
    expect(s.limited).toBe(true);
    // elapsed === 0 → ceil(60000/1000) === 60
    expect(s.retryAfterSec).toBe(60);
  });

  it("clears the block once the window elapses", () => {
    const c = clock();
    const lim = new FailureLimiter(2, 10_000, c.now);
    lim.recordFailure("k");
    lim.recordFailure("k");
    expect(lim.status("k").limited).toBe(true);
    c.advance(10_001);
    expect(lim.status("k").limited).toBe(false);
  });

  it("starts a fresh window for failures after the old one expires", () => {
    const c = clock();
    const lim = new FailureLimiter(2, 10_000, c.now);
    lim.recordFailure("k");
    c.advance(10_001); // window expired
    lim.recordFailure("k"); // count resets to 1, not 2
    expect(lim.status("k").limited).toBe(false);
  });

  it("reset clears a key's failures immediately", () => {
    const c = clock();
    const lim = new FailureLimiter(2, 60_000, c.now);
    lim.recordFailure("k");
    lim.recordFailure("k");
    expect(lim.status("k").limited).toBe(true);
    lim.reset("k");
    expect(lim.status("k").limited).toBe(false);
  });

  it("keys are independent", () => {
    const c = clock();
    const lim = new FailureLimiter(1, 60_000, c.now);
    lim.recordFailure("a");
    expect(lim.status("a").limited).toBe(true);
    expect(lim.status("b").limited).toBe(false);
  });
});

describe("IntervalLimiter", () => {
  it("allows the first call, throttles within the interval, re-allows after it", () => {
    const c = clock(0); // start at 0 so the t= comments below are literal
    const lim = new IntervalLimiter(5000, c.now);
    // Every call records the time, so the gap is measured from the LAST call
    // (throttled or not).
    expect(lim.tooSoon("k")).toBe(false); // t=0, first → allowed (records t=0)
    c.advance(1000);
    expect(lim.tooSoon("k")).toBe(true); // t=1000, 1000<5000 → throttled (records t=1000)
    c.advance(5000);
    expect(lim.tooSoon("k")).toBe(false); // t=6000, 5000 since last → allowed (records t=6000)
    c.advance(4999);
    expect(lim.tooSoon("k")).toBe(true); // t=10999, 4999<5000 → throttled
  });

  it("keys are independent", () => {
    const c = clock();
    const lim = new IntervalLimiter(5000, c.now);
    expect(lim.tooSoon("a")).toBe(false);
    expect(lim.tooSoon("b")).toBe(false);
  });

  it("clear() forgets all keys", () => {
    const c = clock();
    const lim = new IntervalLimiter(5000, c.now);
    lim.tooSoon("k");
    lim.clear();
    expect(lim.tooSoon("k")).toBe(false); // treated as first call again
  });
});
