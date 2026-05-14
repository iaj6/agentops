// ─── Model pricing (Anthropic direct API rates, USD per million tokens) ─────
//
// Cache pricing rules used industry-wide for Anthropic models:
//   cache_creation_input_tokens are billed at 1.25x the base input rate
//   cache_read_input_tokens are billed at 0.10x the base input rate
//
// Phase 1 ships Anthropic-direct rates only. Bedrock rates differ slightly
// (~3% lower for most models) — handled in Phase 2 with a backend-aware
// price table.

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

export interface TokenUsageBlock {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export function resolvePricing(model: string): ModelPricing | null {
  if (ANTHROPIC_PRICING[model]) return ANTHROPIC_PRICING[model]!;
  for (const key of Object.keys(ANTHROPIC_PRICING)) {
    if (model.startsWith(key)) return ANTHROPIC_PRICING[key]!;
  }
  return null;
}

export function computeCost(model: string, usage: TokenUsageBlock): number {
  const pricing = resolvePricing(model);
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
