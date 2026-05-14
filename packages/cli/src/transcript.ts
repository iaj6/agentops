import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeCost, type TokenUsageBlock } from "@agentops/core";

export interface SessionUsage {
  readonly totalCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly byModel: Record<string, number>;
}

export const ZERO_USAGE: SessionUsage = {
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  byModel: {},
};

export function transcriptPath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}

interface TranscriptLine {
  readonly type?: string;
  readonly message?: {
    readonly model?: string;
    readonly usage?: TokenUsageBlock;
  };
  readonly model?: string;
  readonly usage?: TokenUsageBlock;
}

export function readSessionUsage(path: string): SessionUsage {
  if (!existsSync(path)) return ZERO_USAGE;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return ZERO_USAGE;
  }

  const lines = raw.split("\n");
  let totalCostUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const byModel: Record<string, number> = {};

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

    const cost = computeCost(model, usage);
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
  };
}
