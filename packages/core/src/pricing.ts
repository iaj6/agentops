// ─── Model pricing (USD per million tokens) ─────────────────────────────────
//
// Cache pricing rules used industry-wide for Anthropic models:
//   cache_creation_input_tokens are billed at 1.25x the base input rate
//   cache_read_input_tokens are billed at 0.10x the base input rate
//
// Two backends are supported:
//   - "anthropic" (default): Anthropic-direct API rates
//   - "bedrock":             AWS Bedrock rates for Anthropic models
//
// As of 2026-05, Bedrock rates for Anthropic models match the direct API in
// most US regions. We keep a separate BEDROCK_PRICING table anyway so future
// divergence (or region-specific overrides) can land in one place. If you
// notice billing skew, refresh BEDROCK_PRICING against AWS's current
// published rates and bump the "verified" date below.

export type Backend = "anthropic" | "bedrock";

export interface ModelPricing {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly cacheWritePerMTok: number;
  readonly cacheReadPerMTok: number;
}

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWritePerMTok: 18.75,
    cacheReadPerMTok: 1.5,
  },
  "claude-opus-4-6": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWritePerMTok: 18.75,
    cacheReadPerMTok: 1.5,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
  "claude-sonnet-4-5": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
  },
};

// Verified parity with Anthropic-direct rates for us-east-1 / us-west-2 on
// 2026-05-13. If you ship into a non-US region or AWS adjusts published
// rates, override these entries.
export const BEDROCK_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": ANTHROPIC_PRICING["claude-opus-4-7"]!,
  "claude-opus-4-6": ANTHROPIC_PRICING["claude-opus-4-6"]!,
  "claude-sonnet-4-6": ANTHROPIC_PRICING["claude-sonnet-4-6"]!,
  "claude-sonnet-4-5": ANTHROPIC_PRICING["claude-sonnet-4-5"]!,
  "claude-haiku-4-5": ANTHROPIC_PRICING["claude-haiku-4-5"]!,
};

// BEDROCK_PRICING above is a parity copy of the Anthropic-direct rates, not
// AWS's published Bedrock rates. So any Bedrock dollar figure is an estimate:
// the token volumes and "this ran on Bedrock" attribution are exact, but the
// $-conversion uses Anthropic list prices. The dashboard reads this flag to
// flag Bedrock cost as approximate instead of presenting it as authoritative.
// When real per-region Bedrock rates land in BEDROCK_PRICING, flip this to
// false (and bump the verified date) and the dashboard caveat disappears.
export const BEDROCK_PRICING_IS_PARITY_ESTIMATE = true;
export const BEDROCK_PRICING_VERIFIED_DATE = "2026-05-13";

export interface TokenUsageBlock {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

// Bedrock identifiers look like:
//   "anthropic.claude-opus-4-7-20251022-v1:0"            (regional)
//   "us.anthropic.claude-opus-4-7-20251022-v1:0"         (cross-region profile)
// We normalize to the bare model key by stripping the publisher prefix,
// any cross-region prefix, and the version/date suffix.
export function normalizeModelId(model: string): string {
  let key = model;
  if (key.startsWith("us.anthropic.") || key.startsWith("eu.anthropic.") || key.startsWith("apac.anthropic.")) {
    key = key.slice(key.indexOf("anthropic.") + "anthropic.".length);
  } else if (key.startsWith("anthropic.")) {
    key = key.slice("anthropic.".length);
  }
  key = key.replace(/-v\d+:\d+$/, "");
  return key;
}

export function resolvePricing(model: string, backend: Backend = "anthropic"): ModelPricing | null {
  const table = backend === "bedrock" ? BEDROCK_PRICING : ANTHROPIC_PRICING;
  const normalized = normalizeModelId(model);
  if (table[normalized]) return table[normalized]!;
  for (const key of Object.keys(table)) {
    if (normalized.startsWith(key)) return table[key]!;
  }
  return null;
}

export function computeCost(
  model: string,
  usage: TokenUsageBlock,
  backend: Backend = "anthropic",
): number {
  const pricing = resolvePricing(model, backend);
  if (!pricing) return 0;

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  return (
    (input * pricing.inputPerMTok) / 1_000_000 +
    (output * pricing.outputPerMTok) / 1_000_000 +
    (cacheWrite * pricing.cacheWritePerMTok) / 1_000_000 +
    (cacheRead * pricing.cacheReadPerMTok) / 1_000_000
  );
}
