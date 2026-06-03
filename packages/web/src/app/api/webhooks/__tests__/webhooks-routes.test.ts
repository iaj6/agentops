import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getWebhook,
  insertWebhook,
  insertWebhookDelivery,
  listWebhookDeliveries,
  type AgentOpsDb,
} from "@agentops/db";
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

// Stub fetch globally so test-ping routes don't try to hit a real network
const fetchStub = vi.fn(async () => new Response("ok", { status: 200 }));
vi.stubGlobal("fetch", fetchStub);

// The test-ping route dispatches through the SSRF guard, which resolves the
// host via DNS. Mock it so the "https://r/h" fixture resolves to a public
// address and the test stays hermetic.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

// Routes must be imported AFTER vi.mock.
import { GET as listRoute, POST as createRoute } from "@/app/api/webhooks/route";
import {
  GET as detailRoute,
  PATCH as patchRoute,
  DELETE as deleteRoute,
} from "@/app/api/webhooks/[id]/route";
import { POST as testRoute } from "@/app/api/webhooks/[id]/test/route";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  fetchStub.mockClear();
});

describe("GET /api/webhooks", () => {
  it("requires authentication", async () => {
    const res = await listRoute(anonRequest("http://localhost/api/webhooks"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admins", async () => {
    const { token } = createUser(db, { email: "m@x", role: "member" });
    const res = await listRoute(
      authedRequest("http://localhost/api/webhooks", { token }),
    );
    expect(res.status).toBe(403);
  });

  it("admin lists with secret redacted to last 4", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_show",
      url: "https://r/h",
      secret: "whsec_abcdef1234",
      events: ["policy.violated"],
    });
    const res = await listRoute(
      authedRequest("http://localhost/api/webhooks", { token }),
    );
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!.secretLast4).toBe("1234");
    expect("secret" in body[0]!).toBe(false);
  });
});

describe("POST /api/webhooks", () => {
  it("requires admin", async () => {
    const { token } = createUser(db, { email: "m@x", role: "member" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: { url: "https://r/h", events: ["policy.violated"] },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects missing url", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: { events: ["policy.violated"] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-http url", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: { url: "ftp://nope/h", events: ["policy.violated"] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown event types", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: { url: "https://r/h", events: ["something.else"] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it.each([
    "http://localhost/h",
    "http://127.0.0.1/h",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/h",
    "https://192.168.1.1/h",
    "http://[::1]/h",
  ])("rejects SSRF-prone url %s", async (url) => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: { url, events: ["policy.violated"] },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates with a generated secret and returns it once", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: {
          url: "https://r/h",
          description: "primary",
          events: ["policy.violated"],
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as {
      id: string;
      secret: string;
      url: string;
    };
    expect(body.id).toMatch(/^wh_/);
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.url).toBe("https://r/h");

    // Stored
    const stored = getWebhook(db, body.id);
    expect(stored).toBeTruthy();
    expect(stored!.secret).toBe(body.secret);

    // List response redacts the secret
    const listRes = await listRoute(
      authedRequest("http://localhost/api/webhooks", { token }),
    );
    const list = (await jsonOf(listRes)) as Array<Record<string, unknown>>;
    expect("secret" in list[0]!).toBe(false);
  });

  it("accepts a customer-supplied secret", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await createRoute(
      authedRequest("http://localhost/api/webhooks", {
        token,
        body: {
          url: "https://r/h",
          events: ["policy.violated"],
          secret: "this-is-my-pre-existing-secret",
        },
      }),
    );
    const body = (await jsonOf(res)) as { secret: string };
    expect(body.secret).toBe("this-is-my-pre-existing-secret");
  });
});

describe("GET /api/webhooks/[id]", () => {
  it("returns 404 when missing", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await detailRoute(
      authedRequest("http://localhost/api/webhooks/wh_x", {
        token,
        method: "GET",
      }),
      withParams({ id: "wh_x" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns the webhook with delivery history", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_h",
      url: "https://r/h",
      secret: "supersecret",
      events: ["policy.violated"],
    });
    insertWebhookDelivery(db, {
      id: "whd_1",
      webhookId: "wh_h",
      eventId: "evt_1",
      eventType: "policy.violated",
      url: "https://r/h",
      payload: {},
      status: "success",
      attempts: 1,
      responseStatus: 200,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    });

    const res = await detailRoute(
      authedRequest("http://localhost/api/webhooks/wh_h", {
        token,
        method: "GET",
      }),
      withParams({ id: "wh_h" }),
    );
    const body = (await jsonOf(res)) as {
      id: string;
      secretLast4: string;
      deliveries: Array<{ status: string }>;
    };
    expect(body.id).toBe("wh_h");
    expect(body.secretLast4).toBe("cret");
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0]!.status).toBe("success");
  });
});

describe("PATCH /api/webhooks/[id]", () => {
  it("toggles enabled", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_t",
      url: "https://r/h",
      secret: "x",
      events: ["policy.violated"],
    });

    const res = await patchRoute(
      authedRequest("http://localhost/api/webhooks/wh_t", {
        token,
        method: "PATCH",
        body: { enabled: false },
      }),
      withParams({ id: "wh_t" }),
    );
    expect(res.status).toBe(200);
    expect(getWebhook(db, "wh_t")!.enabled).toBe(false);
  });

  it("never echoes the signing secret in the response (redacts to secretLast4)", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_redact",
      url: "https://r/h",
      secret: "whsec_supersecretvalue",
      events: ["policy.violated"],
    });
    const res = await patchRoute(
      authedRequest("http://localhost/api/webhooks/wh_redact", {
        token,
        method: "PATCH",
        body: { description: "updated" },
      }),
      withParams({ id: "wh_redact" }),
    );
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { secret?: string; secretLast4?: string };
    expect(body.secret).toBeUndefined();
    expect(body.secretLast4).toBe("alue");
  });

  it("rejects an SSRF-prone url on update", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_ssrf",
      url: "https://r/h",
      secret: "x",
      events: ["policy.violated"],
    });
    const res = await patchRoute(
      authedRequest("http://localhost/api/webhooks/wh_ssrf", {
        token,
        method: "PATCH",
        body: { url: "http://169.254.169.254/latest/meta-data/" },
      }),
      withParams({ id: "wh_ssrf" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown event types in update", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_e",
      url: "https://r/h",
      secret: "x",
      events: ["policy.violated"],
    });
    const res = await patchRoute(
      authedRequest("http://localhost/api/webhooks/wh_e", {
        token,
        method: "PATCH",
        body: { events: ["not.a.real.event"] },
      }),
      withParams({ id: "wh_e" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/webhooks/[id]", () => {
  it("removes the webhook + its deliveries", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_del",
      url: "https://r/h",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhookDelivery(db, {
      id: "whd_d",
      webhookId: "wh_del",
      eventId: "e",
      eventType: "policy.violated",
      url: "https://r/h",
      payload: {},
      status: "success",
      attempts: 1,
      responseStatus: 200,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    });

    const res = await deleteRoute(
      authedRequest("http://localhost/api/webhooks/wh_del", {
        token,
        method: "DELETE",
      }),
      withParams({ id: "wh_del" }),
    );
    expect(res.status).toBe(200);
    expect(getWebhook(db, "wh_del")).toBeNull();
    expect(listWebhookDeliveries(db, "wh_del")).toHaveLength(0);
  });
});

describe("POST /api/webhooks/[id]/test", () => {
  it("sends a ping and records a delivery", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    insertWebhook(db, {
      id: "wh_test",
      url: "https://r/h",
      secret: "x",
      events: ["policy.violated"],
    });

    const res = await testRoute(
      authedRequest("http://localhost/api/webhooks/wh_test/test", { token }),
      withParams({ id: "wh_test" }),
    );
    expect(res.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const deliveries = listWebhookDeliveries(db, "wh_test");
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("success");
  });

  it("404s if webhook does not exist", async () => {
    const { token } = createUser(db, { email: "a@x", role: "admin" });
    const res = await testRoute(
      authedRequest("http://localhost/api/webhooks/wh_nope/test", { token }),
      withParams({ id: "wh_nope" }),
    );
    expect(res.status).toBe(404);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
