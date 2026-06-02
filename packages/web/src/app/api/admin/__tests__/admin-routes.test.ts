import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AgentOpsDb } from "@agentops/db";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  anonRequest,
  jsonOf,
} from "@/__tests__/_helpers";

// Admin routes now enforce requireAdmin, which resolves the caller against
// the DB (bearer-token lookup), so these tests need the mocked memory DB.
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

// Route imports come after the hoisted mock.
import { GET as statusRoute } from "@/app/api/admin/status/route";
import { GET as costRoute } from "@/app/api/admin/cost/route";
import { GET as analyticsRoute } from "@/app/api/admin/analytics/route";

let db: AgentOpsDb;
let adminToken: string;
let memberToken: string;

// ─── env-var save/restore ────────────────────────────────────────────────────

let savedKey: string | undefined;
beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  adminToken = createUser(db, { email: "admin@example.com", role: "admin" }).token;
  memberToken = createUser(db, { email: "member@example.com", role: "member" }).token;

  savedKey = process.env["ANTHROPIC_ADMIN_API_KEY"];
  delete process.env["ANTHROPIC_ADMIN_API_KEY"];
});
afterEach(() => {
  if (savedKey === undefined) delete process.env["ANTHROPIC_ADMIN_API_KEY"];
  else process.env["ANTHROPIC_ADMIN_API_KEY"] = savedKey;
  vi.unstubAllGlobals();
});

// ─── fetch stub helpers ───────────────────────────────────────────────────────

function stubFetch(options: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: options.ok,
      status: options.status,
      json: options.json ?? (async () => ({})),
      text: options.text ?? (async () => ""),
    })),
  );
}

const adminReq = (path: string) =>
  authedRequest(`http://localhost${path}`, { method: "GET", token: adminToken });
const memberReq = (path: string) =>
  authedRequest(`http://localhost${path}`, { method: "GET", token: memberToken });
const anonReq = (path: string) =>
  anonRequest(`http://localhost${path}`, { method: "GET" });

// ─── auth enforcement (all three routes) ──────────────────────────────────────

describe("admin routes require an admin", () => {
  it("401 for anonymous callers", async () => {
    expect((await statusRoute(anonReq("/api/admin/status"))).status).toBe(401);
    expect((await costRoute(anonReq("/api/admin/cost"))).status).toBe(401);
    expect((await analyticsRoute(anonReq("/api/admin/analytics"))).status).toBe(401);
  });

  it("403 for authenticated non-admin members", async () => {
    expect((await statusRoute(memberReq("/api/admin/status"))).status).toBe(403);
    expect((await costRoute(memberReq("/api/admin/cost"))).status).toBe(403);
    expect((await analyticsRoute(memberReq("/api/admin/analytics"))).status).toBe(403);
  });

  it("does not call upstream Anthropic API for a non-admin even when a key is set", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await costRoute(memberReq("/api/admin/cost"));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── GET /api/admin/status ────────────────────────────────────────────────────

describe("GET /api/admin/status", () => {
  it("returns configured=false when key is absent (admin)", async () => {
    const res = await statusRoute(adminReq("/api/admin/status"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("returns configured=true when key is present (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const res = await statusRoute(adminReq("/api/admin/status"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { configured: boolean };
    expect(body.configured).toBe(true);
  });
});

// ─── GET /api/admin/cost ─────────────────────────────────────────────────────

describe("GET /api/admin/cost", () => {
  it("501 when key is absent (admin, clean error, no stack trace)", async () => {
    const res = await costRoute(adminReq("/api/admin/cost"));
    expect(res.status).toBe(501);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty("stack");
  });

  it("proxies 200 response from upstream when key is present (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fakePayload = { total_cost: 42.5, currency: "USD" };
    stubFetch({ ok: true, status: 200, json: async () => fakePayload });

    const res = await costRoute(adminReq("/api/admin/cost"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as typeof fakePayload;
    expect(body.total_cost).toBe(42.5);
    expect(body.currency).toBe("USD");
  });

  it("surfaces upstream 401 as same status code (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-bad-key";
    stubFetch({ ok: false, status: 401, text: async () => "Unauthorized" });

    const res = await costRoute(adminReq("/api/admin/cost"));
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toContain("401");
  });
});

// ─── GET /api/admin/analytics ─────────────────────────────────────────────────

describe("GET /api/admin/analytics", () => {
  it("501 when key is absent (admin, clean error, no stack trace)", async () => {
    const res = await analyticsRoute(adminReq("/api/admin/analytics"));
    expect(res.status).toBe(501);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty("stack");
  });

  it("proxies 200 response from upstream when key is present (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fakePayload = { data: [{ model: "claude-3-5-sonnet", tokens: 1000 }] };
    stubFetch({ ok: true, status: 200, json: async () => fakePayload });

    const res = await analyticsRoute(adminReq("/api/admin/analytics"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as typeof fakePayload;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.model).toBe("claude-3-5-sonnet");
  });

  it("surfaces upstream 500 as same status code (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    stubFetch({ ok: false, status: 500, text: async () => "Internal Server Error" });

    const res = await analyticsRoute(adminReq("/api/admin/analytics"));
    expect(res.status).toBe(500);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toContain("500");
  });
});
