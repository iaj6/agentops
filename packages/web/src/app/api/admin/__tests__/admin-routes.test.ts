import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { anonRequest, jsonOf } from "@/__tests__/_helpers";

// Admin routes do not touch the DB, so we skip the db mock.
// Route imports must come after any hoisted mocks.
import { GET as statusRoute } from "@/app/api/admin/status/route";
import { GET as costRoute } from "@/app/api/admin/cost/route";
import { GET as analyticsRoute } from "@/app/api/admin/analytics/route";

// ─── env-var save/restore ────────────────────────────────────────────────────

let savedKey: string | undefined;
beforeEach(() => {
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

// ─── GET /api/admin/status ────────────────────────────────────────────────────

describe("GET /api/admin/status", () => {
  it("returns configured=false when key is absent", async () => {
    const req = anonRequest("http://localhost/api/admin/status", {
      method: "GET",
    });
    const res = await statusRoute();
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("returns configured=true when key is present", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const res = await statusRoute();
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { configured: boolean };
    expect(body.configured).toBe(true);
  });
});

// ─── GET /api/admin/cost ─────────────────────────────────────────────────────

describe("GET /api/admin/cost", () => {
  it("501 when key is absent (clean error, no stack trace)", async () => {
    const req = anonRequest("http://localhost/api/admin/cost", {
      method: "GET",
    });
    const res = await costRoute(req);
    expect(res.status).toBe(501);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty("stack");
  });

  it("proxies 200 response from upstream when key is present", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fakePayload = { total_cost: 42.5, currency: "USD" };
    stubFetch({
      ok: true,
      status: 200,
      json: async () => fakePayload,
    });

    const req = anonRequest("http://localhost/api/admin/cost", {
      method: "GET",
    });
    const res = await costRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as typeof fakePayload;
    expect(body.total_cost).toBe(42.5);
    expect(body.currency).toBe("USD");
  });

  it("surfaces upstream 401 as same status code", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-bad-key";
    stubFetch({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const req = anonRequest("http://localhost/api/admin/cost", {
      method: "GET",
    });
    const res = await costRoute(req);
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toContain("401");
  });
});

// ─── GET /api/admin/analytics ─────────────────────────────────────────────────

describe("GET /api/admin/analytics", () => {
  it("501 when key is absent (clean error, no stack trace)", async () => {
    const req = anonRequest("http://localhost/api/admin/analytics", {
      method: "GET",
    });
    const res = await analyticsRoute(req);
    expect(res.status).toBe(501);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toBeTruthy();
    expect(body).not.toHaveProperty("stack");
  });

  it("proxies 200 response from upstream when key is present", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    const fakePayload = { data: [{ model: "claude-3-5-sonnet", tokens: 1000 }] };
    stubFetch({
      ok: true,
      status: 200,
      json: async () => fakePayload,
    });

    const req = anonRequest("http://localhost/api/admin/analytics", {
      method: "GET",
    });
    const res = await analyticsRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as typeof fakePayload;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.model).toBe("claude-3-5-sonnet");
  });

  it("surfaces upstream 500 as same status code", async () => {
    process.env["ANTHROPIC_ADMIN_API_KEY"] = "sk-admin-test-key";
    stubFetch({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const req = anonRequest("http://localhost/api/admin/analytics", {
      method: "GET",
    });
    const res = await analyticsRoute(req);
    expect(res.status).toBe(500);
    const body = (await jsonOf(res)) as { error: string };
    expect(body.error).toContain("500");
  });
});
