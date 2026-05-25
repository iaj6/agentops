import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getBudget,
  insertRun,
  upsertBudget,
  type AgentOpsDb,
} from "@agentops/db";
import {
  createRun,
  startRun,
  createRunId,
} from "@agentops/core";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  anonRequest,
  jsonOf,
  withParams,
} from "@/__tests__/_helpers";

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

// Routes imported after the mock so they pick up the mocked db.
import { GET as listBudgetsRoute } from "@/app/api/budgets/route";
import { GET as meBudgetRoute } from "@/app/api/budgets/me/route";
import {
  PUT as putBudgetRoute,
  DELETE as deleteBudgetRoute,
} from "@/app/api/budgets/[userId]/route";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
});

function makeRun(userId: string, costUsd: number, createdAt: string) {
  const r = startRun(
    createRun(
      {
        humanReadable: "test",
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
  insertRun(db, {
    ...r,
    id: createRunId(`run_${Math.random().toString(36).slice(2, 10)}`),
    userId,
    metrics: { ...r.metrics, costUsd },
    createdAt,
    updatedAt: createdAt,
  });
}

// ─── GET /api/budgets ────────────────────────────────────────────────────

describe("GET /api/budgets", () => {
  it("401 without auth", async () => {
    const res = await listBudgetsRoute(
      anonRequest("http://localhost/api/budgets", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for non-admin members", async () => {
    const { token } = createUser(db, { email: "m@example.com", role: "member" });
    const res = await listBudgetsRoute(
      authedRequest("http://localhost/api/budgets", { method: "GET", token }),
    );
    expect(res.status).toBe(403);
  });

  it("returns rows with computed state for each budget", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const member = createUser(db, { email: "m@example.com", role: "member" });
    upsertBudget(db, {
      userId: member.user.id,
      amountUsd: 100,
      period: "month",
    });
    // One run mid-month (likely inside the current period).
    makeRun(member.user.id, 30, new Date().toISOString());

    const res = await listBudgetsRoute(
      authedRequest("http://localhost/api/budgets", {
        method: "GET",
        token: admin.token,
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf<{
      rows: Array<{ userId: string; budget: { amountUsd: number }; state: { spent: number; status: string } }>;
    }>(res);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].userId).toBe(member.user.id);
    expect(body.rows[0].budget.amountUsd).toBe(100);
    expect(body.rows[0].state.spent).toBe(30);
    expect(body.rows[0].state.status).toBe("ok");
  });
});

// ─── GET /api/budgets/me ─────────────────────────────────────────────────

describe("GET /api/budgets/me", () => {
  it("401 without auth", async () => {
    const res = await meBudgetRoute(
      anonRequest("http://localhost/api/budgets/me", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns { budget: null } when none is set", async () => {
    const { token } = createUser(db, { email: "m@example.com", role: "member" });
    const res = await meBudgetRoute(
      authedRequest("http://localhost/api/budgets/me", { method: "GET", token }),
    );
    const body = await jsonOf<{ budget: null }>(res);
    expect(body.budget).toBeNull();
  });

  it("returns the budget + state when one is set", async () => {
    const { user, token } = createUser(db, {
      email: "m@example.com",
      role: "member",
    });
    upsertBudget(db, { userId: user.id, amountUsd: 50, period: "week" });
    makeRun(user.id, 45, new Date().toISOString()); // 90% of $50 → warning band

    const res = await meBudgetRoute(
      authedRequest("http://localhost/api/budgets/me", { method: "GET", token }),
    );
    const body = await jsonOf<{
      budget: { amountUsd: number };
      state: { status: string; pct: number };
    }>(res);
    expect(body.budget.amountUsd).toBe(50);
    expect(body.state.status).toBe("warning");
    expect(body.state.pct).toBe(90);
  });
});

// ─── PUT /api/budgets/[userId] ───────────────────────────────────────────

describe("PUT /api/budgets/[userId]", () => {
  it("403 for non-admin members", async () => {
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const { token } = createUser(db, { email: "m@example.com", role: "member" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "PUT",
      token,
      body: { amountUsd: 100, period: "month", warnAtPct: 80 },
    });
    const res = await putBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(403);
  });

  it("404 if target user doesn't exist", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const req = authedRequest("http://localhost/api/budgets/no-such-id", {
      method: "PUT",
      token: admin.token,
      body: { amountUsd: 100, period: "month" },
    });
    const res = await putBudgetRoute(req, withParams({ userId: "no-such-id" }));
    expect(res.status).toBe(404);
  });

  it("validates amountUsd > 0", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "PUT",
      token: admin.token,
      body: { amountUsd: 0, period: "month" },
    });
    const res = await putBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(400);
  });

  it("validates period is week|month", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "PUT",
      token: admin.token,
      body: { amountUsd: 50, period: "year" },
    });
    const res = await putBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(400);
  });

  it("upserts and returns the budget", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "PUT",
      token: admin.token,
      body: { amountUsd: 200, period: "month", warnAtPct: 75 },
    });
    const res = await putBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(200);
    const body = await jsonOf<{ budget: { amountUsd: number; warnAtPct: number } }>(res);
    expect(body.budget.amountUsd).toBe(200);
    expect(body.budget.warnAtPct).toBe(75);
    expect(getBudget(db, target.user.id)?.amountUsd).toBe(200);
  });
});

// ─── DELETE /api/budgets/[userId] ────────────────────────────────────────

describe("DELETE /api/budgets/[userId]", () => {
  it("403 for non-admin members", async () => {
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const { token } = createUser(db, { email: "m@example.com", role: "member" });
    upsertBudget(db, { userId: target.user.id, amountUsd: 50, period: "month" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "DELETE",
      token,
    });
    const res = await deleteBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(403);
  });

  it("404 if no budget exists", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const target = createUser(db, { email: "t@example.com", role: "member" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "DELETE",
      token: admin.token,
    });
    const res = await deleteBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(404);
  });

  it("removes the budget when present", async () => {
    const admin = createUser(db, { email: "a@example.com", role: "admin" });
    const target = createUser(db, { email: "t@example.com", role: "member" });
    upsertBudget(db, { userId: target.user.id, amountUsd: 50, period: "month" });
    const req = authedRequest(`http://localhost/api/budgets/${target.user.id}`, {
      method: "DELETE",
      token: admin.token,
    });
    const res = await deleteBudgetRoute(req, withParams({ userId: target.user.id }));
    expect(res.status).toBe(200);
    expect(getBudget(db, target.user.id)).toBeNull();
  });
});
