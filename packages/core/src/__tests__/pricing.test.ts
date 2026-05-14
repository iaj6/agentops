import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_PRICING,
  resolvePricing,
  computeCost,
} from "../pricing.js";

describe("resolvePricing", () => {
  it("returns exact match for known model", () => {
    expect(resolvePricing("claude-opus-4-7")).toBe(
      ANTHROPIC_PRICING["claude-opus-4-7"],
    );
  });

  it("matches by prefix for dated suffixes", () => {
    expect(resolvePricing("claude-sonnet-4-5-20250929")).toBe(
      ANTHROPIC_PRICING["claude-sonnet-4-5"],
    );
  });

  it("returns null for unknown model", () => {
    expect(resolvePricing("gpt-4o")).toBeNull();
  });
});

describe("computeCost", () => {
  it("computes base input + output for Opus 4.7", () => {
    // 1M input @ $15 + 1M output @ $75 = $90
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(90, 6);
  });

  it("applies 0.10x rate to cache reads", () => {
    // 1M cache reads on Opus = $1.50
    const cost = computeCost("claude-opus-4-7", {
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.5, 6);
  });

  it("applies 1.25x rate to cache writes", () => {
    // 1M cache writes on Opus = $18.75
    const cost = computeCost("claude-opus-4-7", {
      cache_creation_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(18.75, 6);
  });

  it("computes mixed usage for Sonnet 4.6", () => {
    // 100k input @ $3 + 50k output @ $15 + 200k cache read @ $0.30 + 50k cache write @ $3.75
    // = 0.30 + 0.75 + 0.06 + 0.1875 = 1.2975
    const cost = computeCost("claude-sonnet-4-6", {
      input_tokens: 100_000,
      output_tokens: 50_000,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 50_000,
    });
    expect(cost).toBeCloseTo(1.2975, 4);
  });

  it("returns 0 for unknown model", () => {
    const cost = computeCost("gpt-4o", { input_tokens: 1_000_000 });
    expect(cost).toBe(0);
  });

  it("handles missing usage fields as zero", () => {
    const cost = computeCost("claude-opus-4-7", {});
    expect(cost).toBe(0);
  });

  it("matches real transcript line for Opus 4.7", () => {
    // Realistic line from a session:
    //   input=6, cache_creation=14483, cache_read=16963, output=472
    // 6*15/1e6 = 0.00009
    // 14483*18.75/1e6 = 0.27155625
    // 16963*1.5/1e6 = 0.0254445
    // 472*75/1e6 = 0.0354
    // sum ~= 0.3324907
    const cost = computeCost("claude-opus-4-7", {
      input_tokens: 6,
      cache_creation_input_tokens: 14483,
      cache_read_input_tokens: 16963,
      output_tokens: 472,
    });
    expect(cost).toBeCloseTo(0.3324907, 4);
  });
});
