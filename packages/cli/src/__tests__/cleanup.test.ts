import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  getDb,
  insertRun,
  insertSession,
  getRun,
  getSession,
  listEvents,
} from "@agentops/db";
import {
  createRun,
  startRun,
  createSession,
  activateSession,
  createRunId,
  createSessionId,
} from "@agentops/core";
import { registerCleanupCommand } from "../commands/cleanup.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = resolve(
    tmpdir(),
    `agentops-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDb(dir: string) {
  const dbPath = resolve(dir, "test.db");
  return { dbPath, db: getDb(dbPath) };
}

async function runCleanup(args: string[], dbPath: string): Promise<string> {
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
    registerCleanupCommand(program);
    await program.parseAsync(["node", "agentops", "cleanup", ...args]);
  } finally {
    console.log = originalLog;
  }
  return output;
}

function makeStaleRun(thresholdMs: number, extraMs = 0) {
  const r = startRun(
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
  // Force updatedAt to be old enough to be stale
  const staleTime = new Date(Date.now() - thresholdMs - extraMs).toISOString();
  return { ...r, updatedAt: staleTime };
}

function makeFreshRun() {
  return startRun(
    createRun(
      {
        humanReadable: "fresh goal",
        structured: { type: "test", description: "test", parameters: {} },
      },
      {
        repo: "acme/fresh",
        branch: "main",
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
    ),
  );
}

function makeStaleSession(thresholdMs: number, extraMs = 0) {
  const s = activateSession(createSession("agent-test"));
  const staleTime = new Date(Date.now() - thresholdMs - extraMs).toISOString();
  return { ...s, lastHeartbeatAt: staleTime };
}

function makeFreshSession() {
  return activateSession(createSession("agent-fresh"));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("agentops cleanup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("empty DB → reports 0 stale runs and 0 stale sessions (dry-run default)", async () => {
    const { dbPath } = makeDb(tmpDir);
    const output = await runCleanup([], dbPath);
    expect(output).toContain("Would reap 0 stale run(s) and 0 stale session(s)");
    expect(output).toContain("Re-run with --apply to actually reap");
  });

  it("fresh active session is not reaped", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    insertSession(db, makeFreshSession());
    const output = await runCleanup([], dbPath);
    expect(output).toContain("Would reap 0 stale run(s) and 0 stale session(s)");
  });

  it("stale session listed in dry-run but NOT mutated in DB", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    // 30-min default threshold; use 60+ min old heartbeat
    const THIRTY_MIN = 30 * 60 * 1000;
    const staleSession = makeStaleSession(THIRTY_MIN, 30 * 60 * 1000);
    insertSession(db, staleSession);

    const output = await runCleanup([], dbPath);
    expect(output).toContain("Would reap 0 stale run(s) and 1 stale session(s)");

    // Should NOT be mutated
    const persisted = getSession(db, staleSession.id);
    expect(persisted?.status).toBe("active");
  });

  it("stale session with --apply flips status to terminated and emits session.terminated event", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const THIRTY_MIN = 30 * 60 * 1000;
    const staleSession = makeStaleSession(THIRTY_MIN, 30 * 60 * 1000);
    insertSession(db, staleSession);

    const output = await runCleanup(["--apply"], dbPath);
    expect(output).toContain("Reaped 0 stale run(s) and 1 stale session(s)");

    const updated = getSession(db, staleSession.id);
    expect(updated?.status).toBe("terminated");
    expect(updated?.terminatedAt).toBeTruthy();

    const events = listEvents(db, { limit: 20 });
    const terminated = events.find(
      (e) => e.type === "session.terminated" && e.sourceId === (staleSession.id as string),
    );
    expect(terminated).toBeDefined();
  });

  it("stale run with --apply flips status to failed and emits run.failed event with stale reason", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const THIRTY_MIN = 30 * 60 * 1000;
    const staleRun = makeStaleRun(THIRTY_MIN, 30 * 60 * 1000);
    insertRun(db, staleRun);

    const output = await runCleanup(["--apply"], dbPath);
    expect(output).toContain("Reaped 1 stale run(s) and 0 stale session(s)");

    const updated = getRun(db, staleRun.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.decisions.some((d) => d.reason.includes("stale"))).toBe(true);

    const events = listEvents(db, { limit: 20 });
    const failed = events.find(
      (e) => e.type === "run.failed" && e.sourceId === (staleRun.id as string),
    );
    expect(failed).toBeDefined();
  });

  it("--threshold-minutes 5 with 6-min-old session reaps it", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const FIVE_MIN = 5 * 60 * 1000;
    const staleSession = makeStaleSession(FIVE_MIN, 60 * 1000); // 6 min old
    insertSession(db, staleSession);

    const output = await runCleanup(["--threshold-minutes", "5"], dbPath);
    expect(output).toContain("Would reap 0 stale run(s) and 1 stale session(s)");
  });

  it("--threshold-minutes 5 with 4-min-old session does NOT reap", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const FOUR_MIN = 4 * 60 * 1000;
    // 4 min old = not stale under 5-min threshold
    const freshEnough = makeStaleSession(FOUR_MIN, -60 * 1000); // 3 min old
    insertSession(db, freshEnough);

    const output = await runCleanup(["--threshold-minutes", "5"], dbPath);
    expect(output).toContain("Would reap 0 stale run(s) and 0 stale session(s)");
  });
});

// ─── Retention (Phase C3) ───────────────────────────────────────────────────

describe("agentops cleanup --runs-older-than", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedRunAt(db: ReturnType<typeof getDb>, id: string, isoTimestamp: string) {
    const r = startRun(
      createRun(
        {
          humanReadable: "retention test",
          structured: { type: "test", description: "test", parameters: {} },
        },
        {
          repo: "acme/retention",
          branch: "main",
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
      ),
    );
    insertRun(db, {
      ...r,
      id: createRunId(id),
      createdAt: isoTimestamp,
      updatedAt: isoTimestamp,
    });
  }

  it("dry-run reports the count without deleting", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    // Two runs: one ~120 days old, one fresh.
    const oneTwentyDaysAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    seedRunAt(db, "run_ancient", oneTwentyDaysAgo);
    seedRunAt(db, "run_new", new Date().toISOString());

    const output = await runCleanup(["--runs-older-than", "90d"], dbPath);
    expect(output).toContain("Would delete 1 run(s) older than 90d");
    expect(output).toContain("Re-run with --apply");
    // Both runs still present.
    expect(getRun(db, createRunId("run_ancient"))).not.toBeNull();
    expect(getRun(db, createRunId("run_new"))).not.toBeNull();
  });

  it("--apply deletes runs older than the cutoff", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const oneTwentyDaysAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    seedRunAt(db, "run_ancient", oneTwentyDaysAgo);
    seedRunAt(db, "run_new", new Date().toISOString());

    const output = await runCleanup(
      ["--runs-older-than", "90d", "--apply"],
      dbPath,
    );
    expect(output).toContain("Deleted 1 run(s) older than 90d");
    expect(output).toContain("Pruned 1 run(s)");
    expect(getRun(db, createRunId("run_ancient"))).toBeNull();
    expect(getRun(db, createRunId("run_new"))).not.toBeNull();
  });

  it("parses week durations (12w)", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const oneHundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    seedRunAt(db, "run_old", oneHundredDaysAgo);
    seedRunAt(db, "run_fresh", new Date().toISOString());

    // 12w = 84d, so a 100d-old run IS older
    const output = await runCleanup(
      ["--runs-older-than", "12w", "--apply"],
      dbPath,
    );
    expect(output).toContain("Deleted 1 run(s)");
    expect(getRun(db, createRunId("run_old"))).toBeNull();
  });

  it("rejects an invalid duration", async () => {
    const { dbPath } = makeDb(tmpDir);
    let threw = false;
    try {
      await runCleanup(["--runs-older-than", "garbage"], dbPath);
    } catch (err) {
      threw = true;
      expect(String(err)).toMatch(/Invalid duration/);
    }
    expect(threw).toBe(true);
  });

  it("can run alongside stale-session cleanup", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    const oneTwentyDaysAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    seedRunAt(db, "run_ancient", oneTwentyDaysAgo);
    // Plus a stale active session.
    const staleSession = makeStaleSession(60 * 60 * 1000); // 60 min stale
    insertSession(db, staleSession);

    const output = await runCleanup(
      ["--runs-older-than", "90d", "--stale-sessions", "--apply"],
      dbPath,
    );
    expect(output).toContain("Pruned 1 run(s)");
    expect(getRun(db, createRunId("run_ancient"))).toBeNull();
    const sess = getSession(db, createSessionId(staleSession.id as string));
    expect(sess!.status).toBe("terminated");
  });

  it("--vacuum runs without throwing", async () => {
    const { dbPath, db } = makeDb(tmpDir);
    seedRunAt(
      db,
      "run_old",
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    );
    const output = await runCleanup(
      ["--runs-older-than", "30d", "--apply", "--vacuum"],
      dbPath,
    );
    expect(output).toContain("Pruned 1 run(s)");
    expect(output).toContain("VACUUM");
  });
});
