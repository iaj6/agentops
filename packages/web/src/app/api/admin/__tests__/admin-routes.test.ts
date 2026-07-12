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

  it("sends starting_at (RFC 3339) and bucket_width to the upstream API", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fetchMock = vi.fn<(url: string) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [], has_more: false, next_page: null }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await costRoute(adminReq("/api/admin/cost?days=7"));
    expect(res.status).toBe(200);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0]);
    expect(calledUrl.pathname).toBe("/v1/organizations/cost_report");
    const startingAt = calledUrl.searchParams.get("starting_at")!;
    // RFC 3339 timestamp snapped to UTC midnight; the old start_date/end_date
    // params were unknown to the API and made every request 400.
    expect(startingAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
    expect(calledUrl.searchParams.get("bucket_width")).toBe("1d");
    expect(calledUrl.searchParams.has("start_date")).toBe(false);
  });

  it("aggregates cent-string amounts into a normalized USD summary (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    // Real cost_report shape: daily buckets, amounts as decimal strings in CENTS.
    const report = {
      data: [
        {
          starting_at: "2026-07-01T00:00:00Z",
          ending_at: "2026-07-02T00:00:00Z",
          results: [
            { amount: "123.78912", currency: "USD" },
            { amount: "76.21088", currency: "USD" },
          ],
        },
        {
          starting_at: "2026-07-02T00:00:00Z",
          ending_at: "2026-07-03T00:00:00Z",
          results: [{ amount: "300", currency: "USD" }],
        },
      ],
      has_more: false,
      next_page: null,
    };
    stubFetch({ ok: true, status: 200, json: async () => report });

    const res = await costRoute(adminReq("/api/admin/cost"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      totalCostUsd: number;
      daily: Array<{ date: string; costUsd: number }>;
      truncated: boolean;
    };
    // 200 cents + 300 cents = $5.00
    expect(body.totalCostUsd).toBeCloseTo(5, 6);
    expect(body.daily).toEqual([
      { date: "2026-07-01", costUsd: 2 },
      { date: "2026-07-02", costUsd: 3 },
    ]);
    expect(body.truncated).toBe(false);
  });

  it("follows has_more/next_page pagination (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const page1 = {
      data: [
        {
          starting_at: "2026-07-01T00:00:00Z",
          ending_at: "2026-07-02T00:00:00Z",
          results: [{ amount: "100", currency: "USD" }],
        },
      ],
      has_more: true,
      next_page: "page_token_2",
    };
    const page2 = {
      data: [
        {
          starting_at: "2026-07-02T00:00:00Z",
          ending_at: "2026-07-03T00:00:00Z",
          results: [{ amount: "100", currency: "USD" }],
        },
      ],
      has_more: false,
      next_page: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await costRoute(adminReq("/api/admin/cost"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(secondUrl.searchParams.get("page")).toBe("page_token_2");
    const body = (await jsonOf(res)) as { totalCostUsd: number; daily: unknown[] };
    expect(body.totalCostUsd).toBeCloseTo(2, 6); // 100c + 100c
    expect(body.daily).toHaveLength(2);
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

  it("normalizes token totals from the usage report shape (admin)", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    // Real usage_report/messages shape.
    const report = {
      data: [
        {
          starting_at: "2026-07-01T00:00:00Z",
          ending_at: "2026-07-02T00:00:00Z",
          results: [
            {
              uncached_input_tokens: 1500,
              cache_read_input_tokens: 200,
              cache_creation: {
                ephemeral_5m_input_tokens: 500,
                ephemeral_1h_input_tokens: 1000,
              },
              output_tokens: 500,
              server_tool_use: { web_search_requests: 10 },
            },
            {
              uncached_input_tokens: 500,
              cache_read_input_tokens: 100,
              cache_creation: {
                ephemeral_5m_input_tokens: 0,
                ephemeral_1h_input_tokens: 0,
              },
              output_tokens: 250,
              server_tool_use: { web_search_requests: 0 },
            },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    stubFetch({ ok: true, status: 200, json: async () => report });

    const res = await analyticsRoute(adminReq("/api/admin/analytics"));
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      uncachedInputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      outputTokens: number;
      webSearchRequests: number;
    };
    expect(body.uncachedInputTokens).toBe(2000);
    expect(body.cacheReadInputTokens).toBe(300);
    expect(body.cacheCreationInputTokens).toBe(1500);
    expect(body.outputTokens).toBe(750);
    expect(body.webSearchRequests).toBe(10);
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
