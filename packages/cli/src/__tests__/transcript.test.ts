import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  transcriptPath,
  readSessionUsage,
  ZERO_USAGE,
} from "../transcript.js";

describe("transcriptPath", () => {
  it("encodes cwd by replacing slashes with dashes", () => {
    const path = transcriptPath("/Users/x/code/repo", "abc-123");
    expect(path).toBe(
      join(homedir(), ".claude", "projects", "-Users-x-code-repo", "abc-123.jsonl"),
    );
  });
});

describe("readSessionUsage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = resolve(
      tmpdir(),
      `agentops-transcript-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns zero usage for missing file", () => {
    expect(readSessionUsage("/nonexistent/path.jsonl")).toEqual(ZERO_USAGE);
  });

  it("returns zero usage for empty file", () => {
    const path = join(tmpDir, "empty.jsonl");
    writeFileSync(path, "", "utf-8");
    expect(readSessionUsage(path)).toEqual(ZERO_USAGE);
  });

  it("sums usage across multiple assistant messages", () => {
    const path = join(tmpDir, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          usage: {
            input_tokens: 6,
            cache_creation_input_tokens: 14483,
            cache_read_input_tokens: 16963,
            output_tokens: 472,
          },
        },
      }),
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 30000,
            output_tokens: 200,
          },
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"), "utf-8");

    const usage = readSessionUsage(path);
    expect(usage.inputTokens).toBe(16);
    expect(usage.outputTokens).toBe(672);
    expect(usage.cacheReadTokens).toBe(46963);
    expect(usage.cacheWriteTokens).toBe(14483);
    expect(usage.totalCostUsd).toBeGreaterThan(0);
    expect(usage.byModel["claude-opus-4-7"]).toBeCloseTo(usage.totalCostUsd, 6);
  });

  it("skips malformed JSON lines", () => {
    const path = join(tmpDir, "broken.jsonl");
    const lines = [
      "not json",
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 1_000_000, output_tokens: 0 },
        },
      }),
      "{ broken",
    ];
    writeFileSync(path, lines.join("\n"), "utf-8");

    const usage = readSessionUsage(path);
    expect(usage.inputTokens).toBe(1_000_000);
    expect(usage.totalCostUsd).toBeCloseTo(3, 4);
  });

  it("skips lines without model or usage", () => {
    const path = join(tmpDir, "partial.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", message: { model: "claude-opus-4-7" } }),
      JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 100 } } }),
    ];
    writeFileSync(path, lines.join("\n"), "utf-8");

    expect(readSessionUsage(path)).toEqual(ZERO_USAGE);
  });

  it("aggregates costs per model across mixed-model sessions", () => {
    const path = join(tmpDir, "mixed.jsonl");
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          usage: { input_tokens: 1_000_000, output_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-haiku-4-5",
          usage: { input_tokens: 1_000_000, output_tokens: 0 },
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"), "utf-8");

    const usage = readSessionUsage(path);
    expect(usage.byModel["claude-opus-4-7"]).toBeCloseTo(15, 4);
    expect(usage.byModel["claude-haiku-4-5"]).toBeCloseTo(1, 4);
    expect(usage.totalCostUsd).toBeCloseTo(16, 4);
  });
});
