import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeCost, resolvePricing, type Backend, type TokenUsageBlock } from "@agentops/core";

export interface SessionUsage {
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly byModel: Record<string, number>;
  // Models seen in the transcript that have no pricing entry. Their tokens
  // are counted above but contribute $0 to totalCostUsd — callers must
  // surface this loudly, or cost ceilings silently fail open.
  readonly unknownModels: readonly string[];
}

export const ZERO_USAGE: SessionUsage = {
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  byModel: {},
  unknownModels: [],
};

// Reads CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX style env vars.
// Anthropic's Claude Code uses CLAUDE_CODE_USE_BEDROCK=1 to route through
// AWS Bedrock; absence (or any non-truthy value) means direct Anthropic API.
export function detectBackend(env: NodeJS.ProcessEnv = process.env): Backend {
  const value = env["CLAUDE_CODE_USE_BEDROCK"];
  if (value && value !== "0" && value.toLowerCase() !== "false") {
    return "bedrock";
  }
  return "anthropic";
}

// Claude Code encodes the project cwd by replacing every non-alphanumeric
// character with "-" (not just "/" — dots, underscores, and spaces too).
// Prefer the transcript_path field from the hook payload when available;
// this reconstruction is the fallback for older payloads.
export function transcriptPath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}

interface TranscriptLine {
  readonly type?: string;
  readonly message?: {
    readonly id?: string;
    readonly model?: string;
    readonly usage?: TokenUsageBlock;
  };
  readonly model?: string;
  readonly usage?: TokenUsageBlock;
}

export function readSessionUsage(
  path: string,
  backend: Backend = "anthropic",
): SessionUsage {
  if (!existsSync(path)) return ZERO_USAGE;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return ZERO_USAGE;
  }

  const lines = raw.split("\n");

  // Claude Code writes one transcript line per content block, and every line
  // for the same API response repeats the same message.id with identical
  // usage. Summing per-line multiplies real cost by blocks-per-message
  // (2-7x in practice) — count each message.id once. Lines without an id
  // (older transcript formats) are counted individually.
  const byMessage = new Map<string, { model: string; usage: TokenUsageBlock }>();
  let anonKey = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    const model = entry.message?.model ?? entry.model;
    const usage = entry.message?.usage ?? entry.usage;
    if (!model || !usage) continue;

    const key = entry.message?.id ?? `__no_id_${anonKey++}`;
    byMessage.set(key, { model, usage });
  }

  let totalCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const byModel: Record<string, number> = {};
  const unknownModels = new Set<string>();

  for (const { model, usage } of byMessage.values()) {
    if (!resolvePricing(model, backend)) unknownModels.add(model);
    const cost = computeCost(model, usage, backend);
    totalCostUsd += cost;
    inputTokens += usage.input_tokens ?? 0;
    outputTokens += usage.output_tokens ?? 0;
    cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    byModel[model] = (byModel[model] ?? 0) + cost;
  }

  return {
    totalCostUsd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    byModel,
    unknownModels: [...unknownModels],
  };
}
