import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  getDb,
  insertWebhook,
  listWebhookDeliveries,
  getWebhook,
  type AgentOpsDb,
} from "@agentops/db";
import {
  dispatchWebhookEvent,
  signPayload,
} from "@/lib/webhook-dispatcher";

function setupDb(): AgentOpsDb {
  return getDb(":memory:");
}

const EVENT = {
  id: "evt_test_1",
  type: "policy.violated",
  payload: {
    runId: "run_abc",
    policy: "Block destructive shell ops",
    message: "Detected rm -rf",
  },
  timestamp: "2026-05-14T12:00:00.000Z",
};

describe("signPayload", () => {
  it("produces the expected HMAC-SHA256 hex prefix", () => {
    const body = "hello";
    const expected = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(signPayload("secret", body)).toBe(expected);
  });

  it("different secrets produce different signatures", () => {
    expect(signPayload("a", "payload")).not.toBe(signPayload("b", "payload"));
  });
});

describe("dispatchWebhookEvent", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = setupDb();
  });

  it("no-op when no subscribers", async () => {
    const fetchMock = vi.fn();
    await dispatchWebhookEvent(db, EVENT, { fetch: fetchMock as unknown as typeof fetch });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires a POST with HMAC signature on the expected event", async () => {
    insertWebhook(db, {
      id: "wh_a",
      url: "https://receiver.example/hook",
      secret: "topsecret",
      events: ["policy.violated"],
    });
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://receiver.example/hook");
    expect(init.method).toBe("POST");
    const body = init.body as string;
    const sig = (init.headers as Record<string, string>)["X-AgentOps-Signature"];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sig).toBe(signPayload("topsecret", body));
    expect((init.headers as Record<string, string>)["X-AgentOps-Event"]).toBe(
      "policy.violated",
    );

    // Body wraps the event in a canonical envelope
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.id).toBe("evt_test_1");
    expect(parsed.type).toBe("policy.violated");
    expect(parsed.data).toEqual(EVENT.payload);

    // Delivery recorded
    const deliveries = listWebhookDeliveries(db, "wh_a");
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("success");
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.responseStatus).toBe(200);

    // Webhook's last-delivery summary updated
    const w = getWebhook(db, "wh_a")!;
    expect(w.lastDeliveryStatus).toBe("success");
    expect(w.lastDeliveryAt).toBeTruthy();
  });

  it("retries once on 5xx and records both attempts as one delivery", async () => {
    insertWebhook(db, {
      id: "wh_retry",
      url: "https://receiver.example/r",
      secret: "x",
      events: ["policy.violated"],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
      delay: async () => {}, // skip the 30s wait in tests
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = listWebhookDeliveries(db, "wh_retry");
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("success");
    expect(deliveries[0]!.attempts).toBe(2);
  });

  it("records failure with attempts=2 after second 5xx", async () => {
    insertWebhook(db, {
      id: "wh_fail",
      url: "https://receiver.example/f",
      secret: "x",
      events: ["policy.violated"],
    });

    const fetchMock = vi.fn(
      async () => new Response("nope", { status: 502 }),
    );
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
      delay: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = listWebhookDeliveries(db, "wh_fail");
    expect(deliveries[0]!.status).toBe("failed");
    expect(deliveries[0]!.attempts).toBe(2);
    expect(deliveries[0]!.responseStatus).toBe(502);
  });

  it("does not retry on 4xx (e.g. 404)", async () => {
    insertWebhook(db, {
      id: "wh_4xx",
      url: "https://receiver.example/g",
      secret: "x",
      events: ["policy.violated"],
    });

    const fetchMock = vi.fn(
      async () => new Response("nope", { status: 404 }),
    );
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
      delay: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deliveries = listWebhookDeliveries(db, "wh_4xx");
    expect(deliveries[0]!.status).toBe("failed");
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.responseStatus).toBe(404);
  });

  it("retries once on 429 (rate limit)", async () => {
    insertWebhook(db, {
      id: "wh_429",
      url: "https://receiver.example/x",
      secret: "x",
      events: ["policy.violated"],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
      delay: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = listWebhookDeliveries(db, "wh_429");
    expect(deliveries[0]!.status).toBe("success");
    expect(deliveries[0]!.attempts).toBe(2);
  });

  it("records network errors and retries once", async () => {
    insertWebhook(db, {
      id: "wh_net",
      url: "https://receiver.example/n",
      secret: "x",
      events: ["policy.violated"],
    });

    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
      delay: async () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deliveries = listWebhookDeliveries(db, "wh_net");
    expect(deliveries[0]!.status).toBe("failed");
    expect(deliveries[0]!.errorMessage).toContain("fetch failed");
  });

  it("skips disabled webhooks", async () => {
    insertWebhook(db, {
      id: "wh_off",
      url: "https://receiver.example/off",
      secret: "x",
      events: ["policy.violated"],
      enabled: false,
    });
    const fetchMock = vi.fn();
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters by subscribed event type", async () => {
    insertWebhook(db, {
      id: "wh_other",
      url: "https://receiver.example/o",
      secret: "x",
      events: ["some.other.event"],
    });
    const fetchMock = vi.fn();
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fans out to multiple subscribers in parallel", async () => {
    insertWebhook(db, {
      id: "wh_1",
      url: "https://a/h",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhook(db, {
      id: "wh_2",
      url: "https://b/h",
      secret: "x",
      events: ["policy.violated"],
    });
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    await dispatchWebhookEvent(db, EVENT, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listWebhookDeliveries(db, "wh_1")).toHaveLength(1);
    expect(listWebhookDeliveries(db, "wh_2")).toHaveLength(1);
  });
});
