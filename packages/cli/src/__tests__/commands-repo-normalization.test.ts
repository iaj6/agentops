import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import { getDb, listRuns, listJobs } from "@agentops/db";
import { registerRunCommands } from "../commands/run.js";
import { registerJobCommands } from "../commands/job.js";

// Proves the CLI write paths that accept an explicit --repo option
// (`run start`, `job submit`) canonicalize it on write, so an operator-typed
// mixed-case slug or remote URL buckets identically to wrap/hook/SDK runs.

const dirs: string[] = [];

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `agentops-reponorm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function runCli(args: string[], dbPath: string): Promise<void> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const program = new Command();
    program
      .name("agentops")
      .allowUnknownOption()
      .option("--db-path <path>", "DB path", dbPath)
      .option("--json");
    registerRunCommands(program);
    registerJobCommands(program);
    await program.parseAsync(["node", "agentops", ...args]);
  } finally {
    console.log = originalLog;
  }
}

describe("CLI --repo write-path normalization", () => {
  it("`run start --repo` persists a canonical lowercase owner/name", async () => {
    const dir = makeTmpDir();
    const dbPath = resolve(dir, "test.db");
    const db = getDb(dbPath);

    await runCli(["run", "start", "fix a bug", "--repo", "Iaj6/AgentOps"], dbPath);

    const runs = listRuns(db, { limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.environment.repo).toBe("iaj6/agentops");
  });

  it("`job submit --repo` canonicalizes a full remote URL", async () => {
    const dir = makeTmpDir();
    const dbPath = resolve(dir, "test.db");
    const db = getDb(dbPath);

    await runCli(
      ["job", "submit", "ship it", "--repo", "git@github.com:Iaj6/AgentOps.git"],
      dbPath,
    );

    const jobs = listJobs(db, { limit: 10 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.environment.repo).toBe("iaj6/agentops");
  });

  it("the default --repo ('unknown') round-trips unchanged", async () => {
    const dir = makeTmpDir();
    const dbPath = resolve(dir, "test.db");
    const db = getDb(dbPath);

    await runCli(["run", "start", "no repo flag"], dbPath);

    const runs = listRuns(db, { limit: 10 });
    expect(runs[0]!.environment.repo).toBe("unknown");
  });
});
