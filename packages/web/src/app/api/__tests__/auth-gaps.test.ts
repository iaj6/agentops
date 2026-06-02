import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertRun,
  insertPolicy,
  insertSession,
  type AgentOpsDb,
} from "@agentops/db";
import {
  createRun,
  startRun,
  createRunId,
  createPolicyId,
  createSessionId,
  createAgentId,
  PolicyType,
  PolicySeverity,
  SessionStatus,
  type Run,
  type Session,
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

// Regression coverage for the auth gaps fixed in fix/auth-gaps-and-gh-injection:
//   #1 POST /api/runs/[id]/decide had no auth and trusted a body `actor`
//   #2 /api/policies + /api/policies/[id] CRUD had no auth
//   #4 /api/sessions/active, /api/usage/local, POST /api/runs/search leaked
//      cross-tenant data without auth/scoping

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

vi.mock("@/lib/db", () => ({ db: () => getTestDb() }));

// Routes imported after the mock so they pick up the mocked db.
import { POST as decideRoute } from "@/app/api/runs/[id]/decide/route";
import {
  GET as listPoliciesRoute,
  POST as createPolicyRoute,
} from "@/app/api/policies/route";
import {
  GET as getPolicyRoute,
  PATCH as patchPolicyRoute,
  PUT as putPolicyRoute,
  DELETE as deletePolicyRoute,
} from "@/app/api/policies/[id]/route";
import { GET as activeSessionsRoute } from "@/app/api/sessions/active/route";
import { GET as usageLocalRoute } from "@/app/api/usage/local/route";
import { POST as searchMetaRoute } from "@/app/api/runs/search/route";

let db: AgentOpsDb;
let admin: TestUser;
let owner: TestUser;
let other: TestUser;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  admin = createUser(db, { email: "admin@example.com", role: "admin" });
  owner = createUser(db, { email: "owner@example.com", role: "member" });
  other = createUser(db, { email: "other@example.com", role: "member" });
});

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeRun(opts: { userId?: string; repo?: string; costUsd?: number }): Run {
  const r = startRun(
    createRun(
      {
        humanReadable: "test",
        structured: { type: "test", description: "test", parameters: {} },
      },
      {
        repo: opts.repo ?? "acme/test",
        branch: "main",
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
    ),
  );
  const run: Run = {
    ...r,
    id: createRunId(`run_${Math.random().toString(36).slice(2, 10)}`),
    userId: opts.userId,
    metrics: { ...r.metrics, costUsd: opts.costUsd ?? 0 },
  };
  insertRun(db, run);
  return run;
}

function makeActiveSession(id: string, userId?: string): void {
  const session: Session = {
    id: createSessionId(id),
    status: SessionStatus.Active,
    agentId: createAgentId("agent_1"),
    currentRunId: null,
    completedRunIds: [],
    resourceUsage: { memoryMb: 1, cpuPercent: 1, tokensBudgetRemaining: 1, costBudgetRemaining: 1 },
    metadata: {},
    startedAt: "2025-01-01T00:00:00.000Z",
    lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
    terminatedAt: null,
    userId,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  insertSession(db, session);
}

function seedPolicy(id = "pol_test") {
  insertPolicy(db, {
    id: createPolicyId(id),
    name: "Cost ceiling",
    type: PolicyType.CostCeiling,
    config: { type: "costCeiling", maxUsd: 10 },
    severity: PolicySeverity.Warning,
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  });
}

// ─── #1 POST /api/runs/[id]/decide ─────────────────────────────────────────────

describe("POST /api/runs/[id]/decide", () => {
  it("401 without auth", async () => {
    const run = makeRun({ userId: owner.user.id });
    const res = await decideRoute(
      anonRequest(`http://localhost/api/runs/${run.id}/decide`, {
        body: { decision: "Approve", reason: "lgtm" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(res.status).toBe(401);
  });

  it("404 for a member who does not own the run (no leak of existence)", async () => {
    const run = makeRun({ userId: owner.user.id });
    const res = await decideRoute(
      authedRequest(`http://localhost/api/runs/${run.id}/decide`, {
        token: other.token,
        body: { decision: "Approve", reason: "nope" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(res.status).toBe(404);
  });

  it("records the authenticated user as actor — never a caller-supplied value", async () => {
    const run = makeRun({ userId: owner.user.id });
    const res = await decideRoute(
      authedRequest(`http://localhost/api/runs/${run.id}/decide`, {
        token: owner.token,
        // Attempt to forge the audit trail — must be ignored.
        body: { decision: "Approve", reason: "lgtm", actor: "ceo@evil.example" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { decisions: Array<{ actor: string }> };
    const actors = body.decisions.map((d) => d.actor);
    expect(actors).toContain("owner@example.com");
    expect(actors).not.toContain("ceo@evil.example");
  });

  it("admin may decide on any run", async () => {
    const run = makeRun({ userId: owner.user.id });
    const res = await decideRoute(
      authedRequest(`http://localhost/api/runs/${run.id}/decide`, {
        token: admin.token,
        body: { decision: "Approve", reason: "approved by admin" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(res.status).toBe(200);
  });

  it("null-owner (pre-auth / local-dev) runs are admin-only", async () => {
    // userId omitted → stored as null; auth.ts documents these as admin-only.
    const run = makeRun({});
    const memRes = await decideRoute(
      authedRequest(`http://localhost/api/runs/${run.id}/decide`, {
        token: owner.token,
        body: { decision: "Approve", reason: "x" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(memRes.status).toBe(404);

    const adminRes = await decideRoute(
      authedRequest(`http://localhost/api/runs/${run.id}/decide`, {
        token: admin.token,
        body: { decision: "Approve", reason: "x" },
      }),
      withParams({ id: run.id as string }),
    );
    expect(adminRes.status).toBe(200);
  });
});

// ─── #2 /api/policies (control plane) ──────────────────────────────────────────

describe("/api/policies auth", () => {
  it("POST create: 401 anon, 403 member, 201 admin", async () => {
    const makeBody = () => ({
      name: "p",
      type: "costCeiling",
      config: { type: "costCeiling", maxUsd: 5 },
      severity: "warning",
    });
    expect(
      (await createPolicyRoute(anonRequest("http://localhost/api/policies", { body: makeBody() }))).status,
    ).toBe(401);
    expect(
      (await createPolicyRoute(
        authedRequest("http://localhost/api/policies", { token: owner.token, body: makeBody() }),
      )).status,
    ).toBe(403);
    expect(
      (await createPolicyRoute(
        authedRequest("http://localhost/api/policies", { token: admin.token, body: makeBody() }),
      )).status,
    ).toBe(201);
  });

  it("GET list: 401 anon, 200 for any authenticated member (read-only view)", async () => {
    seedPolicy();
    expect(
      (await listPoliciesRoute(anonRequest("http://localhost/api/policies", { method: "GET" }))).status,
    ).toBe(401);
    expect(
      (await listPoliciesRoute(
        authedRequest("http://localhost/api/policies", { method: "GET", token: owner.token }),
      )).status,
    ).toBe(200);
  });

  it("GET [id]: 401 anon, 200 member", async () => {
    seedPolicy();
    const anon = await getPolicyRoute(
      anonRequest("http://localhost/api/policies/pol_test", { method: "GET" }),
      withParams({ id: "pol_test" }),
    );
    expect(anon.status).toBe(401);
    const mem = await getPolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", { method: "GET", token: owner.token }),
      withParams({ id: "pol_test" }),
    );
    expect(mem.status).toBe(200);
  });

  it("PATCH [id]: 403 member cannot disable a policy, 200 admin can", async () => {
    seedPolicy();
    const memRes = await patchPolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", {
        method: "PATCH",
        token: owner.token,
        body: { enabled: false },
      }),
      withParams({ id: "pol_test" }),
    );
    expect(memRes.status).toBe(403);

    const adminRes = await patchPolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", {
        method: "PATCH",
        token: admin.token,
        body: { enabled: false },
      }),
      withParams({ id: "pol_test" }),
    );
    expect(adminRes.status).toBe(200);
  });

  it("PUT [id]: 401 anon, 403 member, 200 admin", async () => {
    seedPolicy();
    const body = {
      name: "renamed",
      config: { type: "costCeiling", maxUsd: 20 },
      severity: "error",
    };
    const anon = await putPolicyRoute(
      anonRequest("http://localhost/api/policies/pol_test", { method: "PUT", body }),
      withParams({ id: "pol_test" }),
    );
    expect(anon.status).toBe(401);

    const mem = await putPolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", { method: "PUT", token: owner.token, body }),
      withParams({ id: "pol_test" }),
    );
    expect(mem.status).toBe(403);

    const adm = await putPolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", { method: "PUT", token: admin.token, body }),
      withParams({ id: "pol_test" }),
    );
    expect(adm.status).toBe(200);
  });

  it("DELETE [id]: 403 member, 200 admin", async () => {
    seedPolicy();
    const memRes = await deletePolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", { method: "DELETE", token: owner.token }),
      withParams({ id: "pol_test" }),
    );
    expect(memRes.status).toBe(403);

    const adminRes = await deletePolicyRoute(
      authedRequest("http://localhost/api/policies/pol_test", { method: "DELETE", token: admin.token }),
      withParams({ id: "pol_test" }),
    );
    expect(adminRes.status).toBe(200);
  });
});

// ─── #4 cross-tenant read leaks ─────────────────────────────────────────────────

describe("GET /api/sessions/active scoping", () => {
  beforeEach(() => {
    makeActiveSession("sess_owner", owner.user.id);
    makeActiveSession("sess_other", other.user.id);
  });

  it("401 without auth", async () => {
    const res = await activeSessionsRoute(
      anonRequest("http://localhost/api/sessions/active", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("a member sees only their own active sessions", async () => {
    const res = await activeSessionsRoute(
      authedRequest("http://localhost/api/sessions/active", { method: "GET", token: owner.token }),
    );
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { sessions: Array<{ id: string }>; count: number };
    expect(body.count).toBe(1);
    expect(body.sessions.map((s) => s.id)).toEqual(["sess_owner"]);
  });

  it("an admin sees the whole fleet", async () => {
    const res = await activeSessionsRoute(
      authedRequest("http://localhost/api/sessions/active", { method: "GET", token: admin.token }),
    );
    const body = (await jsonOf(res)) as { count: number };
    expect(body.count).toBe(2);
  });
});

describe("GET /api/usage/local scoping", () => {
  beforeEach(() => {
    makeRun({ userId: owner.user.id, costUsd: 10 });
    makeRun({ userId: other.user.id, costUsd: 99 });
  });

  it("401 without auth", async () => {
    const res = await usageLocalRoute(anonRequest("http://localhost/api/usage/local", { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("a member's totals exclude other users' runs", async () => {
    const res = await usageLocalRoute(
      authedRequest("http://localhost/api/usage/local", { method: "GET", token: owner.token }),
    );
    const body = (await jsonOf(res)) as { totalCost: number; totalRuns: number };
    expect(body.totalCost).toBe(10);
    expect(body.totalRuns).toBe(1);
  });
});

describe("POST /api/runs/search (filter options) scoping", () => {
  beforeEach(() => {
    makeRun({ userId: owner.user.id, repo: "owner/repo" });
    makeRun({ userId: other.user.id, repo: "other/repo" });
  });

  it("401 without auth", async () => {
    const res = await searchMetaRoute(anonRequest("http://localhost/api/runs/search", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("a member only sees repos from their own runs", async () => {
    const res = await searchMetaRoute(
      authedRequest("http://localhost/api/runs/search", { method: "POST", token: owner.token }),
    );
    const body = (await jsonOf(res)) as { repos: string[] };
    expect(body.repos).toEqual(["owner/repo"]);
  });
});
