import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  getDb,
  insertRun,
  getRunSummary,
} from "@agentops/db";
import {
  createRun,
  startRun,
} from "@agentops/core";
import { registerAdminCommands } from "../commands/admin.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `agentops-admin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDb(dir: string) {
  const dbPath = resolve(dir, "test.db");
  return { dbPath, db: getDb(dbPath) };
}

async function runAdmin(args: string[], dbPath: string): Promise<string> {
  let output = "";
  const originalLog = console.log;
  console.log = (...parts: unknown[]) => {
    output += parts.join(" ") + "\n";
  };
  try {
    const program = new Command();
    program
      .name("agentops")
      .allowUnknownOption()
      .option("--db-path <path>", "DB path", dbPath)
      .option("--json");
    registerAdminCommands(program);
    await program.parseAsync(["node", "agentops", "admin", ...args]);
  } finally {
    console.log = originalLog;
  }
  return output;
}

function makeCompletedRun(costUsd = 0) {
  const run = startRun(
    createRun(
      {
        humanReadable: "test goal",
        structured: { type: "test", description: "test", parameters: {} },
      },
      {
        repo: "acme/test",
        branch: "main",
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
    ),
  );
  // Mark as completed by setting status directly (completeRun requires an Evaluation)
  return {
    ...run,
    status: "completed" as const,
    metrics: {
      ...run.metrics,
      costUsd,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("agentops admin regenerate-summaries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("empty DB → reports 'Would update 0 run summaries' with --dry-run", async () => {
    const { dbPath } = makeDb(tmpDir);
    const output = await runAdmin(["regenerate-summaries", "--dry-run"], dbPath);
    expect(output).toContain("Would update 0 run summar");
  });

  it("completed run with --dry-run shows new headline without writing to DB", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const run = makeCompletedRun(1.5);
    insertRun(db, run);

    const output = await runAdmin(
      ["regenerate-summaries", "--dry-run"],
      dbPath,
    );
    expect(output).toContain("Would update 1 run summar");
    // In dry-run mode, the DB summary should NOT be written
    const summary = getRunSummary(db, run.id);
    expect(summary).toBeNull();
  });

  it("run with costUsd > 0: after regenerate, summary headline contains dollar amount", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const run = makeCompletedRun(2.75);
    insertRun(db, run);

    const output = await runAdmin(["regenerate-summaries"], dbPath);
    expect(output).toContain("Updated 1 run summar");

    const summary = getRunSummary(db, run.id);
    expect(summary).not.toBeNull();
    // The headline should include the cost in some form ($ symbol or "2.75")
    expect(summary!.headline).toMatch(/\$|2\.75|cost/i);
  });

  it("--limit 1 only processes one run when multiple are present", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    insertRun(db, makeCompletedRun(1.0));
    insertRun(db, makeCompletedRun(2.0));
    insertRun(db, makeCompletedRun(3.0));

    const output = await runAdmin(
      ["regenerate-summaries", "--limit", "1"],
      dbPath,
    );
    expect(output).toContain("Updated 1 run summar");
    expect(output).toContain("processed 1");
  });
});
