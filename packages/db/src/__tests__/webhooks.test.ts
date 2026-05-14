import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import {
  insertWebhook,
  getWebhook,
  listWebhooks,
  listEnabledWebhooksForEvent,
  updateWebhook,
  deleteWebhook,
  insertWebhookDelivery,
  listWebhookDeliveries,
} from "../webhooks.js";

describe("webhooks repo", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("insert + get roundtrips", () => {
    insertWebhook(db, {
      id: "wh_test",
      url: "https://example.com/hook",
      description: "test",
      secret: "whsec_supersecret",
      events: ["policy.violated"],
    });
    const w = getWebhook(db, "wh_test");
    expect(w).toBeTruthy();
    expect(w!.url).toBe("https://example.com/hook");
    expect(w!.events).toEqual(["policy.violated"]);
    expect(w!.enabled).toBe(true);
    expect(w!.secret).toBe("whsec_supersecret");
  });

  it("listEnabledWebhooksForEvent filters by enabled and event type", () => {
    insertWebhook(db, {
      id: "wh_a",
      url: "https://a.example/h",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhook(db, {
      id: "wh_b",
      url: "https://b.example/h",
      secret: "x",
      events: ["policy.violated"],
      enabled: false,
    });
    insertWebhook(db, {
      id: "wh_c",
      url: "https://c.example/h",
      secret: "x",
      events: ["other.event"],
    });

    const subs = listEnabledWebhooksForEvent(db, "policy.violated");
    expect(subs.map((s) => s.id)).toEqual(["wh_a"]);
  });

  it("updateWebhook sets fields", () => {
    insertWebhook(db, {
      id: "wh_u",
      url: "https://u.example/h",
      secret: "x",
      events: ["policy.violated"],
    });
    updateWebhook(db, "wh_u", {
      enabled: false,
      lastDeliveryAt: "2026-01-01T00:00:00.000Z",
      lastDeliveryStatus: "failed",
    });
    const w = getWebhook(db, "wh_u")!;
    expect(w.enabled).toBe(false);
    expect(w.lastDeliveryAt).toBe("2026-01-01T00:00:00.000Z");
    expect(w.lastDeliveryStatus).toBe("failed");
  });

  it("deleteWebhook cascades delivery records", () => {
    insertWebhook(db, {
      id: "wh_d",
      url: "https://d.example/h",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhookDelivery(db, {
      id: "whd_1",
      webhookId: "wh_d",
      eventId: "evt_1",
      eventType: "policy.violated",
      url: "https://d.example/h",
      payload: { foo: "bar" },
      status: "success",
      attempts: 1,
      responseStatus: 200,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(listWebhookDeliveries(db, "wh_d")).toHaveLength(1);

    deleteWebhook(db, "wh_d");
    expect(getWebhook(db, "wh_d")).toBeNull();
    expect(listWebhookDeliveries(db, "wh_d")).toHaveLength(0);
  });

  it("listWebhookDeliveries orders most-recent first", () => {
    insertWebhook(db, {
      id: "wh_ord",
      url: "https://o.example/h",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhookDelivery(db, {
      id: "whd_old",
      webhookId: "wh_ord",
      eventId: "evt_old",
      eventType: "policy.violated",
      url: "https://o.example/h",
      payload: {},
      status: "success",
      attempts: 1,
      responseStatus: 200,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
    });
    insertWebhookDelivery(db, {
      id: "whd_new",
      webhookId: "wh_ord",
      eventId: "evt_new",
      eventType: "policy.violated",
      url: "https://o.example/h",
      payload: {},
      status: "failed",
      attempts: 2,
      responseStatus: 500,
      errorMessage: "server error",
      createdAt: "2026-01-02T00:00:00.000Z",
      completedAt: "2026-01-02T00:00:30.000Z",
    });
    const rows = listWebhookDeliveries(db, "wh_ord");
    expect(rows.map((r) => r.id)).toEqual(["whd_new", "whd_old"]);
  });

  it("listWebhooks returns all rows regardless of enabled", () => {
    insertWebhook(db, {
      id: "wh_on",
      url: "https://x",
      secret: "x",
      events: ["policy.violated"],
    });
    insertWebhook(db, {
      id: "wh_off",
      url: "https://y",
      secret: "y",
      events: ["policy.violated"],
      enabled: false,
    });
    expect(listWebhooks(db).map((w) => w.id).sort()).toEqual([
      "wh_off",
      "wh_on",
    ]);
  });
});
