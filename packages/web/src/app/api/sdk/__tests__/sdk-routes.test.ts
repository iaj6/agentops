import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertRun,
  insertSession,
  insertPolicy,
  getRun,
  listEvents,
  type AgentOpsDb,
} from "@agentops/db";
import {
  createRun,
  startRun,
  createSession,
  activateSession,
  createPolicyId,
  PolicySeverity,
  PolicyType,
} from "@agentops/core";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  anonRequest,
  jsonOf,
  withParams,
  type TestUser,
} from "@/__tests__/_helpers";

// Per-file DB mock. Each test gets a fresh :memory: DB via beforeEach
// + setTestDb. The hoisted getter sees whatever was last set.

const { getTestDb, setTestDb } = vi.hoisted(() => {
  let _db: AgentOpsDb | null = null;
  return {
    getTestDb: () => {
      if (!_db) throw new Error("Test DB not set");
      return _db;
    },
    setTestDb: (db: AgentOpsDb) => {
      _db = db;
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: () => getTestDb(),
}));

// Route imports must come AFTER vi.mock so they pick up the mocked db.
import { POST as createSessionRoute } from "@/app/api/sdk/sessions/route";
import { POST as createRunRoute } from "@/app/api/sdk/runs/route";
import { POST as reportActionRoute } from "@/app/api/sdk/runs/[id]/actions/route";
import { POST as reportArtifactRoute } from "@/app/api/sdk/runs/[id]/artifacts/route";
import { POST as reportMetricsRoute } from "@/app/api/sdk/runs/[id]/metrics/route";
import { POST as completeRunRoute } from "@/app/api/sdk/runs/[id]/complete/route";
import { POST as failRunRoute } from "@/app/api/sdk/runs/[id]/fail/route";
import { POST as heartbeatRoute } from "@/app/api/sdk/sessions/[id]/heartbeat/route";
import { POST as terminateSessionRoute } from "@/app/api/sdk/sessions/[id]/terminate/route";
import { POST as policyCheckRoute } from "@/app/api/sdk/policy/check/route";

let db: AgentOpsDb;
let alice: TestUser;
let bob: TestUser;
let admin: TestUser;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  alice = createUser(db, { email: "alice@example.com" });
  bob = createUser(db, { email: "bob@example.com" });
  admin = createUser(db, { email: "admin@example.com", role: "admin" });
});

// Helpers: pre-seed a run/session owned by a specific user, ready for
// downstream ownership / mutation tests.
function seedRun(owner: TestUser): { runId: string } {
  const base = startRun(
    createRun(
      {
        humanReadable: "Test",
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
  const run = { ...base, userId: owner.user.id };
  insertRun(db, run);
  return { runId: run.id as string };
}

function seedSession(owner: TestUser): { sessionId: string } {
  const session = activateSession(createSession("test-agent", {}));
  const tagged = { ...session, userId: owner.user.id };
  insertSession(db, tagged);
  return { sessionId: tagged.id as string };
}

// ─── POST /api/sdk/sessions ───────────────────────────────────────────────

describe("POST /api/sdk/sessions", () => {
  it("rejects requests without Bearer", async () => {
    const req = anonRequest("http://localhost/api/sdk/sessions", {
      body: { agentId: "claude" },
    });
    const res = await createSessionRoute(req);
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as { error?: string; requestId?: string };
    expect(body.error).toContain("Bearer");
    expect(body.requestId).toBe("test-req-id");
  });

  it("rejects bogus tokens", async () => {
    const req = authedRequest("http://localhost/api/sdk/sessions", {
      token: "ao_bogus",
      body: { agentId: "x" },
    });
    const res = await createSessionRoute(req);
    expect(res.status).toBe(401);
  });

  it("creates a session tagged with the calling user", async () => {
    const req = authedRequest("http://localhost/api/sdk/sessions", {
      token: alice.token,
      body: { agentId: "claude-code", metadata: { cwd: "/tmp" } },
    });
    const res = await createSessionRoute(req);
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as { sessionId?: string };
    expect(body.sessionId).toBeTruthy();
    const { getSession } = await import("@agentops/db");
    const { createSessionId } = await import("@agentops/core");
    const saved = getSession(db, createSessionId(body.sessionId!));
    expect(saved!.userId).toBe(alice.user.id);
  });

  it("400 when agentId is missing", async () => {
    const req = authedRequest("http://localhost/api/sdk/sessions", {
      token: alice.token,
      body: {},
    });
    const res = await createSessionRoute(req);
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/sdk/runs ───────────────────────────────────────────────────

describe("POST /api/sdk/runs", () => {
  const validBody = {
    goal: { humanReadable: "Fix bug" },
    environment: { repo: "acme/api", branch: "main" },
  };

  it("rejects unauthenticated", async () => {
    const req = anonRequest("http://localhost/api/sdk/runs", { body: validBody });
    const res = await createRunRoute(req);
    expect(res.status).toBe(401);
  });

  it("creates a run tagged with the calling user", async () => {
    const req = authedRequest("http://localhost/api/sdk/runs", {
      token: alice.token,
      body: validBody,
    });
    const res = await createRunRoute(req);
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as { runId?: string };
    expect(body.runId).toBeTruthy();
    const { createRunId } = await import("@agentops/core");
    const saved = getRun(db, createRunId(body.runId!));
    expect(saved!.userId).toBe(alice.user.id);
  });

  it("400 on missing goal", async () => {
    const req = authedRequest("http://localhost/api/sdk/runs", {
      token: alice.token,
      body: { environment: validBody.environment },
    });
    const res = await createRunRoute(req);
    expect(res.status).toBe(400);
  });

  it("400 on missing environment", async () => {
    const req = authedRequest("http://localhost/api/sdk/runs", {
      token: alice.token,
      body: { goal: validBody.goal },
    });
    const res = await createRunRoute(req);
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/sdk/runs/[id]/actions ──────────────────────────────────────

describe("POST /api/sdk/runs/[id]/actions", () => {
  it("404 when run is unknown", async () => {
    const req = authedRequest("http://localhost/api/sdk/runs/missing/actions", {
      token: alice.token,
      body: {},
    });
    const res = await reportActionRoute(req, withParams({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("404 when caller does not own the run (member)", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/actions`, {
      token: bob.token,
      body: { toolCalls: [] },
    });
    const res = await reportActionRoute(req, withParams({ id: runId }));
    // Member sees 404 not 403 — don't leak which run IDs exist.
    expect(res.status).toBe(404);
  });

  it("admin can act on any user's run", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/actions`, {
      token: admin.token,
      body: { toolCalls: [], fileEdits: [], commands: [] },
    });
    const res = await reportActionRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);
  });

  it("owner can add an action", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/actions`, {
      token: alice.token,
      body: { toolCalls: [], fileEdits: [], commands: [] },
    });
    const res = await reportActionRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/sdk/runs/[id]/artifacts ────────────────────────────────────

describe("POST /api/sdk/runs/[id]/artifacts", () => {
  it("ownership: member 404s on another user's run", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/artifacts`, {
      token: bob.token,
      body: { diffs: ["x"] },
    });
    const res = await reportArtifactRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(404);
  });

  it("happy path stores the artifact", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/artifacts`, {
      token: alice.token,
      body: { diffs: ["diff body"], logs: [], testOutputs: [], reports: [] },
    });
    const res = await reportArtifactRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/sdk/runs/[id]/metrics ──────────────────────────────────────

describe("POST /api/sdk/runs/[id]/metrics", () => {
  it("happy path updates run.metrics", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/metrics`, {
      token: alice.token,
      body: {
        costUsd: 1.23,
        wallTimeMs: 5000,
        flakeRate: 0,
        tokenUsage: { input: 100, output: 50, total: 150 },
      },
    });
    const res = await reportMetricsRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);

    const { createRunId } = await import("@agentops/core");
    const run = getRun(db, createRunId(runId))!;
    expect(run.metrics.costUsd).toBe(1.23);
  });

  it("400 on bad type", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/metrics`, {
      token: alice.token,
      body: { costUsd: "not a number" },
    });
    const res = await reportMetricsRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/sdk/runs/[id]/complete ─────────────────────────────────────

describe("POST /api/sdk/runs/[id]/complete", () => {
  it("flips status to completed", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/complete`, {
      token: alice.token,
      body: {},
    });
    const res = await completeRunRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);
    const { createRunId } = await import("@agentops/core");
    expect(getRun(db, createRunId(runId))!.status).toBe("completed");
  });

  it("member cannot complete another user's run", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/complete`, {
      token: bob.token,
      body: {},
    });
    const res = await completeRunRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/sdk/runs/[id]/fail ─────────────────────────────────────────

describe("POST /api/sdk/runs/[id]/fail", () => {
  it("requires error string in body", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/fail`, {
      token: alice.token,
      body: {},
    });
    const res = await failRunRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(400);
  });

  it("flips status to failed and records decision", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest(`http://localhost/api/sdk/runs/${runId}/fail`, {
      token: alice.token,
      body: { error: "explosion" },
    });
    const res = await failRunRoute(req, withParams({ id: runId }));
    expect(res.status).toBe(200);
    const { createRunId } = await import("@agentops/core");
    const r = getRun(db, createRunId(runId))!;
    expect(r.status).toBe("failed");
  });
});

// ─── POST /api/sdk/sessions/[id]/heartbeat ────────────────────────────────

describe("POST /api/sdk/sessions/[id]/heartbeat", () => {
  it("404 on non-owner", async () => {
    const { sessionId } = seedSession(alice);
    const req = authedRequest(`http://localhost/api/sdk/sessions/${sessionId}/heartbeat`, {
      token: bob.token,
      body: {},
    });
    const res = await heartbeatRoute(req, withParams({ id: sessionId }));
    expect(res.status).toBe(404);
  });

  it("happy path returns ok", async () => {
    const { sessionId } = seedSession(alice);
    const req = authedRequest(`http://localhost/api/sdk/sessions/${sessionId}/heartbeat`, {
      token: alice.token,
      body: {},
    });
    const res = await heartbeatRoute(req, withParams({ id: sessionId }));
    expect(res.status).toBe(200);
  });
});

// ─── POST /api/sdk/sessions/[id]/terminate ────────────────────────────────

describe("POST /api/sdk/sessions/[id]/terminate", () => {
  it("terminates the session", async () => {
    const { sessionId } = seedSession(alice);
    const req = authedRequest(`http://localhost/api/sdk/sessions/${sessionId}/terminate`, {
      token: alice.token,
      body: {},
    });
    const res = await terminateSessionRoute(req, withParams({ id: sessionId }));
    expect(res.status).toBe(200);
    const { getSession, createSessionId } = await import("@agentops/db");
    const { createSessionId: csid } = await import("@agentops/core");
    const s = getSession(db, csid(sessionId))!;
    expect(s.status).toBe("terminated");
  });

  it("member cannot terminate another user's session", async () => {
    const { sessionId } = seedSession(alice);
    const req = authedRequest(`http://localhost/api/sdk/sessions/${sessionId}/terminate`, {
      token: bob.token,
      body: {},
    });
    const res = await terminateSessionRoute(req, withParams({ id: sessionId }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/sdk/policy/check ───────────────────────────────────────────

describe("POST /api/sdk/policy/check", () => {
  it("400 on missing runId", async () => {
    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: { toolName: "Bash", toolInput: {} },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(400);
  });

  it("allow when no policies", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: { runId, toolName: "Bash", toolInput: { command: "ls" } },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { decision?: string };
    expect(body.decision).toBe("allow");
  });

  it("block on risky-op policy match", async () => {
    const { runId } = seedRun(alice);
    insertPolicy(db, {
      id: createPolicyId("p_risk"),
      name: "Block rm",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: { runId, toolName: "Bash", toolInput: { command: "rm -rf /" } },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { decision?: string; reason?: string };
    expect(body.decision).toBe("block");
    expect(body.reason).toContain("Block rm");
  });

  it("block on cost ceiling when cumulativeCostUsd exceeds limit", async () => {
    const { runId } = seedRun(alice);
    insertPolicy(db, {
      id: createPolicyId("p_cost"),
      name: "$5 ceiling",
      type: PolicyType.CostCeiling,
      config: { type: PolicyType.CostCeiling, maxUsd: 5 },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: { runId, toolName: "Bash", toolInput: {}, cumulativeCostUsd: 6.27 },
    });
    const res = await policyCheckRoute(req);
    const body = (await jsonOf(res)) as { decision?: string; reason?: string };
    expect(body.decision).toBe("block");
    expect(body.reason).toContain("Cost ceiling");
  });

  it("404 when caller does not own the run", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: bob.token,
      body: { runId, toolName: "Bash", toolInput: {} },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(404);
  });

  it("emits policy.violated event on block (parity with DirectOps)", async () => {
    const { runId } = seedRun(alice);
    insertPolicy(db, {
      id: createPolicyId("p_audit"),
      name: "Block rm",
      type: PolicyType.RiskyOpFlag,
      config: { type: PolicyType.RiskyOpFlag, riskyPatterns: ["rm -rf"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: {
        runId,
        toolName: "Bash",
        toolInput: { command: "rm -rf /tmp/x" },
      },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(200);

    const events = listEvents(db, { limit: 20 });
    const violation = events.find(
      (e) => e.type === "policy.violated" && e.sourceId === runId,
    );
    expect(violation).toBeDefined();
    expect((violation!.payload as { toolName: string }).toolName).toBe("Bash");
  });

  it("does NOT emit policy.violated on allow", async () => {
    const { runId } = seedRun(alice);
    const req = authedRequest("http://localhost/api/sdk/policy/check", {
      token: alice.token,
      body: { runId, toolName: "Bash", toolInput: { command: "ls" } },
    });
    const res = await policyCheckRoute(req);
    expect(res.status).toBe(200);

    const events = listEvents(db, { limit: 20 });
    const violation = events.find(
      (e) => e.type === "policy.violated" && e.sourceId === runId,
    );
    expect(violation).toBeUndefined();
  });
});
