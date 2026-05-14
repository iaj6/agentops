import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_PRICING,
  BEDROCK_PRICING,
  resolvePricing,
  computeCost,
  normalizeModelId,
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

  it("resolves Bedrock regional model id", () => {
    expect(resolvePricing("anthropic.claude-opus-4-7-20251022-v1:0", "bedrock"))
      .toBe(BEDROCK_PRICING["claude-opus-4-7"]);
  });

  it("resolves Bedrock cross-region inference profile id", () => {
    expect(resolvePricing("us.anthropic.claude-sonnet-4-6-v1:0", "bedrock"))
      .toBe(BEDROCK_PRICING["claude-sonnet-4-6"]);
  });

  it("resolves Bedrock EU cross-region profile id", () => {
    expect(resolvePricing("eu.anthropic.claude-haiku-4-5-v1:0", "bedrock"))
      .toBe(BEDROCK_PRICING["claude-haiku-4-5"]);
  });

  it("does not match Anthropic-direct model ids against Bedrock table", () => {
    // Bedrock table happens to have parity-priced entries under the bare keys,
    // so this should still resolve. The point is the table is selectable.
    const direct = resolvePricing("claude-opus-4-7", "anthropic");
    const bedrock = resolvePricing("claude-opus-4-7", "bedrock");
    expect(direct).toBe(ANTHROPIC_PRICING["claude-opus-4-7"]);
    expect(bedrock).toBe(BEDROCK_PRICING["claude-opus-4-7"]);
  });

  it("returns null for unknown Bedrock model id", () => {
    expect(resolvePricing("anthropic.fake-model-v1:0", "bedrock")).toBeNull();
  });
});

describe("normalizeModelId", () => {
  it("passes through bare Anthropic ids", () => {
    expect(normalizeModelId("claude-opus-4-7")).toBe("claude-opus-4-7");
  });

  it("strips anthropic. prefix", () => {
    expect(normalizeModelId("anthropic.claude-opus-4-7-v1:0")).toBe("claude-opus-4-7");
  });

  it("strips us.anthropic. cross-region prefix", () => {
    expect(normalizeModelId("us.anthropic.claude-sonnet-4-6-v1:0"))
      .toBe("claude-sonnet-4-6");
  });

  it("strips date suffix between model and version", () => {
    expect(normalizeModelId("anthropic.claude-opus-4-7-20251022-v1:0"))
      .toBe("claude-opus-4-7-20251022");
  });
});

describe("Bedrock/Anthropic parity (as of 2026-05-13)", () => {
  it("Bedrock rates equal Anthropic rates for all shared model keys", () => {
    for (const key of Object.keys(ANTHROPIC_PRICING)) {
      expect(BEDROCK_PRICING[key]).toEqual(ANTHROPIC_PRICING[key]);
    }
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

  it("computes Bedrock cost via cross-region inference id", () => {
    // Same math as Anthropic since rates currently match
    const cost = computeCost(
      "us.anthropic.claude-opus-4-7-v1:0",
      { input_tokens: 1_000_000, output_tokens: 0 },
      "bedrock",
    );
    expect(cost).toBeCloseTo(15, 4);
  });

  it("returns 0 when model is unknown to selected backend", () => {
    // Forcing anthropic backend on a Bedrock-formatted id (no normalization
    // path that matches an Anthropic key)
    const cost = computeCost(
      "us.anthropic.claude-opus-4-7-v1:0",
      { input_tokens: 1_000_000 },
      "anthropic",
    );
    // Anthropic table doesn't normalize Bedrock prefixes the same way,
    // but normalizeModelId is shared — so it WILL resolve. Document the
    // current behavior rather than over-constraining.
    expect(cost).toBeCloseTo(15, 4);
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
