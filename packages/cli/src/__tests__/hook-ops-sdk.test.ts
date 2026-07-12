import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createOps, resolveOpsConfig, isSdkMode, SdkError, sdkTimeoutMs } from "../hook-ops.js";
import { outboxPath } from "../outbox.js";
import type { Action, Metrics } from "@agentops/core";
import { createActionId } from "@agentops/core";

// Tests SdkOps behavior end-to-end via the public HookOps interface:
//   - Happy path: fetch returns 200/201, no outbox writes
//   - Transient (5xx / network): event queued, no throw, log to stderr
//   - Permanent (4xx): SdkError thrown, NOT queued
//   - Subsequent call drains pending entries before issuing the new one
//   - Non-outboxed calls (checkPolicy, startSessionAndRun, completeRun,
//     terminateSession) throw on failure as documented
//
// Mocking strategy: vi.stubGlobal("fetch", ...). Each test installs a
// fresh mock that returns a sequence of responses. After the call we
// inspect both the fetch invocations and the on-disk outbox file.

const FAKE_SERVER = "http://localhost:9999";
const FAKE_TOKEN = "ao_test_token";

let tmpHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let savedEnv: { url?: string; key?: string };

interface MockResponse {
  status?: number;
  body?: unknown;
  /** Throws to simulate a network error. */
  networkError?: string;
}

function mockFetch(responses: MockResponse[]): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1]!;
    i++;
    if (r.networkError) throw new Error(r.networkError);
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function readOutbox(sessionId: string): Array<{ op: string; args: unknown[]; attempts: number }> {
  const path = outboxPath(sessionId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function makeAction(suffix = "1"): Action {
  return {
    id: createActionId(`act_test_${suffix}`),
    toolCalls: [
      { name: "Bash", input: { command: "ls" }, output: "file1\n", timestamp: "2026-01-01T00:00:00Z" },
    ],
    fileEdits: [],
    commands: [
      { command: "ls", exitCode: 0, stdout: "file1", stderr: "", timestamp: "2026-01-01T00:00:00Z" },
    ],
    timestamp: "2026-01-01T00:00:00Z",
  };
}

function makeMetrics(): Metrics {
  return {
    tokenUsage: { input: 100, output: 50, total: 150 },
    wallTimeMs: 1234,
    costUsd: 0.05,
    flakeRate: 0,
  };
}

beforeEach(() => {
  tmpHome = resolve(
    tmpdir(),
    `agentops-sdkops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpHome, { recursive: true });
  originalHome = process.env["HOME"];
  originalUserProfile = process.env["USERPROFILE"];
  process.env["HOME"] = tmpHome;
  process.env["USERPROFILE"] = tmpHome;

  savedEnv = {
    url: process.env["AGENTOPS_SERVER_URL"],
    key: process.env["AGENTOPS_API_KEY"],
  };
  process.env["AGENTOPS_SERVER_URL"] = FAKE_SERVER;
  process.env["AGENTOPS_API_KEY"] = FAKE_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;
  if (savedEnv.url === undefined) delete process.env["AGENTOPS_SERVER_URL"];
  else process.env["AGENTOPS_SERVER_URL"] = savedEnv.url;
  if (savedEnv.key === undefined) delete process.env["AGENTOPS_API_KEY"];
  else process.env["AGENTOPS_API_KEY"] = savedEnv.key;
  try {
    rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── Mode selection sanity ─────────────────────────────────────────────────

describe("resolveOpsConfig + createOps", () => {
  it("flips into SDK mode when env vars are set", () => {
    const config = resolveOpsConfig();
    expect(isSdkMode(config)).toBe(true);
    expect(config.serverUrl).toBe(FAKE_SERVER);
    expect(config.token).toBe(FAKE_TOKEN);
  });

  it("falls back to direct mode when env vars are absent and no creds.json", () => {
    delete process.env["AGENTOPS_SERVER_URL"];
    delete process.env["AGENTOPS_API_KEY"];
    const config = resolveOpsConfig();
    expect(isSdkMode(config)).toBe(false);
  });
});

// ─── Fetch timeout ─────────────────────────────────────────────────────────
//
// A dashboard that HANGS (accepts the connection but never responds) must
// not stall the hook until Claude Code's 60s hook timeout. Every SDK fetch
// carries AbortSignal.timeout(sdkTimeoutMs()); the resulting rejection is
// caught like any network error (status 0), so it follows the existing
// transient semantics: outboxed for reports, thrown (→ fail-open in the
// handlers) for synchronous policy decisions.

describe("SDK fetch timeout", () => {
  let savedTimeout: string | undefined;

  beforeEach(() => {
    savedTimeout = process.env["AGENTOPS_SDK_TIMEOUT_MS"];
  });

  afterEach(() => {
    if (savedTimeout === undefined) delete process.env["AGENTOPS_SDK_TIMEOUT_MS"];
    else process.env["AGENTOPS_SDK_TIMEOUT_MS"] = savedTimeout;
  });

  /** Fetch stub that never resolves — only rejects when its signal aborts. */
  function mockHangingFetch(): ReturnType<typeof vi.fn> {
    const fn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) return; // no signal → hang forever (test would time out)
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("defaults to 5000ms, honors AGENTOPS_SDK_TIMEOUT_MS, ignores garbage", () => {
    delete process.env["AGENTOPS_SDK_TIMEOUT_MS"];
    expect(sdkTimeoutMs()).toBe(5000);
    process.env["AGENTOPS_SDK_TIMEOUT_MS"] = "250";
    expect(sdkTimeoutMs()).toBe(250);
    process.env["AGENTOPS_SDK_TIMEOUT_MS"] = "not-a-number";
    expect(sdkTimeoutMs()).toBe(5000);
    process.env["AGENTOPS_SDK_TIMEOUT_MS"] = "-1";
    expect(sdkTimeoutMs()).toBe(5000);
  });

  it("attaches an AbortSignal to every SDK fetch", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { ok: true } }]);
    const ops = createOps(resolveOpsConfig(), "timeout-signal-session");

    await ops.reportAction("run_abc", makeAction());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("checkPolicy against a hanging server rejects with SdkError status 0 (transient)", async () => {
    process.env["AGENTOPS_SDK_TIMEOUT_MS"] = "25";
    mockHangingFetch();
    const ops = createOps(resolveOpsConfig(), "timeout-hang-session");

    let caught: unknown;
    try {
      await ops.checkPolicy({
        runId: "run_abc",
        toolName: "Bash",
        toolInput: { command: "ls" },
        cumulativeCostUsd: 0,
      });
      expect.unreachable("checkPolicy should have thrown");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SdkError);
    // Status 0 = network-shaped failure → handlers fail-open (or block
    // under AGENTOPS_FAIL_CLOSED), exactly like a refused connection.
    expect((caught as SdkError).status).toBe(0);
  });

  it("reportAction against a hanging server is queued in the outbox, not thrown", async () => {
    process.env["AGENTOPS_SDK_TIMEOUT_MS"] = "25";
    mockHangingFetch();
    const ops = createOps(resolveOpsConfig(), "timeout-outbox-session");

    const errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      await expect(ops.reportAction("run_abc", makeAction())).resolves.toBeUndefined();
    } finally {
      errSpy.mockRestore();
    }

    const outbox = readOutbox("timeout-outbox-session");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.op).toBe("reportAction");
  });
});

// ─── Happy path ────────────────────────────────────────────────────────────

describe("SdkOps happy path", () => {
  it("reportAction posts to /api/sdk/runs/<id>/actions with Bearer auth", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { ok: true } }]);
    const ops = createOps(resolveOpsConfig(), "happy-session");

    await ops.reportAction("run_abc", makeAction());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${FAKE_SERVER}/api/sdk/runs/run_abc/actions`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(headers["Content-Type"]).toBe("application/json");

    expect(readOutbox("happy-session")).toHaveLength(0);
  });

  it("startSessionAndRun posts session then run, returns both ids", async () => {
    const fetchMock = mockFetch([
      { status: 201, body: { sessionId: "sess_1", status: "active" } },
      { status: 201, body: { runId: "run_1", status: "running" } },
    ]);
    const ops = createOps(resolveOpsConfig(), "start-session");

    const r = await ops.startSessionAndRun({
      claudeSessionId: "claude-test",
      cwd: "/tmp",
      repo: "acme/repo",
      branch: "main",
    });

    expect(r.sessionId).toBe("sess_1");
    expect(r.runId).toBe("run_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchMock.mock.calls[0]![0] as string;
    const secondCall = fetchMock.mock.calls[1]![0] as string;
    expect(firstCall).toBe(`${FAKE_SERVER}/api/sdk/sessions`);
    expect(secondCall).toBe(`${FAKE_SERVER}/api/sdk/runs`);
  });

  it("checkPolicy returns the decision verbatim", async () => {
    mockFetch([
      {
        status: 200,
        body: {
          decision: "block",
          reason: "boom",
          violations: [],
          warnings: [],
        },
      },
    ]);
    const ops = createOps(resolveOpsConfig(), "check-session");

    const d = await ops.checkPolicy({
      runId: "run_1",
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      cumulativeCostUsd: 0,
    });

    expect(d.decision).toBe("block");
    expect(d.reason).toBe("boom");
  });

  it("finalizeRun makes artifact + metrics + complete in order", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { ok: true } }, // artifact
      { status: 200, body: { ok: true } }, // metrics
      { status: 200, body: {} }, // complete
    ]);
    const ops = createOps(resolveOpsConfig(), "fin-session");

    await ops.finalizeRun({
      runId: "run_x",
      sessionId: "sess_x",
      metrics: makeMetrics(),
      diff: "diff body",
      changedFilesCount: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]![0]).toContain("/artifacts");
    expect(fetchMock.mock.calls[1]![0]).toContain("/metrics");
    expect(fetchMock.mock.calls[2]![0]).toContain("/complete");
  });
});

// ─── Transient failure → outbox ───────────────────────────────────────────

describe("SdkOps transient failures", () => {
  it("reportAction on 503 queues to outbox (does not throw)", async () => {
    mockFetch([{ status: 503, body: { error: "upstream" } }]);
    const ops = createOps(resolveOpsConfig(), "q-session");

    // Should NOT throw — fail-open with outbox queue
    await expect(
      ops.reportAction("run_q", makeAction("first")),
    ).resolves.toBeUndefined();

    const entries = readOutbox("q-session");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.op).toBe("reportAction");
    const argRunId = (entries[0]!.args as unknown[])[0];
    expect(argRunId).toBe("run_q");
  });

  it("reportAction on network error queues to outbox", async () => {
    mockFetch([{ networkError: "ECONNREFUSED" }]);
    const ops = createOps(resolveOpsConfig(), "neterr-session");

    await expect(
      ops.reportAction("run_q", makeAction()),
    ).resolves.toBeUndefined();

    const entries = readOutbox("neterr-session");
    expect(entries).toHaveLength(1);
  });

  it("subsequent call drains queued entries before its own work", async () => {
    // Call 1: transient, queues.
    mockFetch([{ status: 503 }]);
    let ops = createOps(resolveOpsConfig(), "drain-session");
    await ops.reportAction("run_d", makeAction("a"));
    expect(readOutbox("drain-session")).toHaveLength(1);

    // Now reset fetch with: drain success, then the new call also succeeds.
    const replay = mockFetch([
      { status: 200, body: { ok: true } }, // drains queued reportAction
      { status: 200, body: { ok: true } }, // the new reportAction
    ]);
    ops = createOps(resolveOpsConfig(), "drain-session");
    await ops.reportAction("run_d", makeAction("b"));

    expect(replay).toHaveBeenCalledTimes(2);
    // First replay call is the drained one (action "a").
    const drainBody = JSON.parse(
      (replay.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(drainBody.id).toBe("act_test_a");
    // Outbox is empty.
    expect(readOutbox("drain-session")).toHaveLength(0);
  });

  it("transient-failing drain leaves the entry in the outbox with incremented attempts", async () => {
    mockFetch([{ status: 503 }]);
    let ops = createOps(resolveOpsConfig(), "stuck-session");
    await ops.reportAction("run_s", makeAction("first"));
    expect(readOutbox("stuck-session")).toHaveLength(1);

    // Drain attempt also fails 503; the new call also queues.
    mockFetch([
      { status: 503 }, // drain attempt
      { status: 503 }, // new call
    ]);
    ops = createOps(resolveOpsConfig(), "stuck-session");
    await ops.reportAction("run_s", makeAction("second"));

    const entries = readOutbox("stuck-session");
    expect(entries.length).toBe(2);
    // The original entry now has attempts >= 1.
    const original = entries.find((e) => (e.args[1] as Action).id === "act_test_first");
    expect(original).toBeDefined();
    expect(original!.attempts).toBeGreaterThanOrEqual(1);
  });
});

// ─── Permanent failure → throws, no outbox ────────────────────────────────

describe("SdkOps permanent failures", () => {
  it("reportAction on 401 throws SdkError and does NOT queue", async () => {
    mockFetch([{ status: 401, body: { error: "Invalid token" } }]);
    const ops = createOps(resolveOpsConfig(), "auth-session");

    await expect(ops.reportAction("run_a", makeAction())).rejects.toThrow(SdkError);
    expect(readOutbox("auth-session")).toHaveLength(0);
  });

  it("reportAction on 403 throws and does NOT queue", async () => {
    mockFetch([{ status: 403, body: { error: "Not your run" } }]);
    const ops = createOps(resolveOpsConfig(), "forbidden-session");
    await expect(ops.reportAction("run_a", makeAction())).rejects.toThrow(SdkError);
    expect(readOutbox("forbidden-session")).toHaveLength(0);
  });

  it("reportAction on 404 throws and does NOT queue", async () => {
    mockFetch([{ status: 404, body: { error: "Run not found" } }]);
    const ops = createOps(resolveOpsConfig(), "notfound-session");
    await expect(ops.reportAction("run_a", makeAction())).rejects.toThrow(SdkError);
    expect(readOutbox("notfound-session")).toHaveLength(0);
  });
});

// ─── Non-outboxed call types ──────────────────────────────────────────────

describe("SdkOps non-outboxed calls", () => {
  it("startSessionAndRun throws on failure (no outbox)", async () => {
    mockFetch([{ status: 500, body: { error: "oops" } }]);
    const ops = createOps(resolveOpsConfig(), "init-session");
    await expect(
      ops.startSessionAndRun({
        claudeSessionId: "x",
        cwd: "/tmp",
        repo: "a/b",
        branch: "main",
      }),
    ).rejects.toThrow(SdkError);
    expect(readOutbox("init-session")).toHaveLength(0);
  });

  it("checkPolicy throws on failure (no outbox)", async () => {
    mockFetch([{ status: 500 }]);
    const ops = createOps(resolveOpsConfig(), "policy-session");
    await expect(
      ops.checkPolicy({
        runId: "run_x",
        toolName: "Bash",
        toolInput: {},
        cumulativeCostUsd: 0,
      }),
    ).rejects.toThrow(SdkError);
    expect(readOutbox("policy-session")).toHaveLength(0);
  });

  it("terminateSession throws on failure (no outbox)", async () => {
    mockFetch([{ status: 500 }]);
    const ops = createOps(resolveOpsConfig(), "term-session");
    await expect(ops.terminateSession("sess_x")).rejects.toThrow(SdkError);
    expect(readOutbox("term-session")).toHaveLength(0);
  });

  it("finalizeRun's complete failure throws (artifact + metrics succeed via outbox if needed)", async () => {
    mockFetch([
      { status: 200, body: { ok: true } }, // artifact
      { status: 200, body: { ok: true } }, // metrics
      { status: 500 }, // complete — NOT outboxed, throws
    ]);
    const ops = createOps(resolveOpsConfig(), "fin-fail-session");
    await expect(
      ops.finalizeRun({
        runId: "run_x",
        sessionId: "sess_x",
        metrics: makeMetrics(),
        diff: "d",
        changedFilesCount: 1,
      }),
    ).rejects.toThrow(SdkError);
    // Artifact + metrics succeeded, no outbox entries.
    expect(readOutbox("fin-fail-session")).toHaveLength(0);
  });
});
