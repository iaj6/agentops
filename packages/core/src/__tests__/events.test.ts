import { describe, it, expect, vi } from "vitest";
import { EVENT_TYPES, createEvent, EventBus } from "../events.js";
import { EventCategory } from "../types.js";
import type { AgentEvent } from "../types.js";

describe("EVENT_TYPES", () => {
  it("has all expected run event types", () => {
    expect(EVENT_TYPES["run.started"]).toBe("run.started");
    expect(EVENT_TYPES["run.completed"]).toBe("run.completed");
    expect(EVENT_TYPES["run.failed"]).toBe("run.failed");
  });

  it("has all expected session event types", () => {
    expect(EVENT_TYPES["session.started"]).toBe("session.started");
    expect(EVENT_TYPES["session.terminated"]).toBe("session.terminated");
  });

  it("has policy and cost event types", () => {
    expect(EVENT_TYPES["policy.violated"]).toBe("policy.violated");
    expect(EVENT_TYPES["cost.threshold"]).toBe("cost.threshold");
  });

  it("has action event type", () => {
    expect(EVENT_TYPES["action.taken"]).toBe("action.taken");
  });
});

describe("createEvent", () => {
  it("creates an event with all required fields", () => {
    const event = createEvent(
      EventCategory.Run,
      EVENT_TYPES["run.started"],
      "run_123",
      { priority: "high" },
    );

    expect(event.id).toContain("evt_");
    expect(event.category).toBe(EventCategory.Run);
    expect(event.type).toBe("run.started");
    expect(event.sourceId).toBe("run_123");
    expect(event.payload).toEqual({ priority: "high" });
    expect(event.timestamp).toBeTruthy();
  });

  it("defaults payload to empty object", () => {
    const event = createEvent(
      EventCategory.Run,
      EVENT_TYPES["run.started"],
      "run_456",
    );

    expect(event.payload).toEqual({});
  });

  it("generates unique IDs", () => {
    const event1 = createEvent(EventCategory.Job, "job.queued", "job_1");
    const event2 = createEvent(EventCategory.Job, "job.queued", "job_2");
    expect(event1.id).not.toBe(event2.id);
  });
});

describe("EventBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe("job.queued", handler);

    const event = createEvent(EventCategory.Job, "job.queued", "job_1");
    bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not deliver events to non-matching subscribers", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe("job.completed", handler);

    const event = createEvent(EventCategory.Job, "job.queued", "job_1");
    bus.publish(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports wildcard '*' subscription", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.subscribe("*", handler);

    const event1 = createEvent(EventCategory.Job, "job.queued", "job_1");
    const event2 = createEvent(EventCategory.Run, "run.started", "run_1");

    bus.publish(event1);
    bus.publish(event2);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(event1);
    expect(handler).toHaveBeenCalledWith(event2);
  });

  it("supports multiple subscribers for the same type", () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe("run.completed", handler1);
    bus.subscribe("run.completed", handler2);

    const event = createEvent(EventCategory.Run, "run.completed", "run_1");
    bus.publish(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("unsubscribe removes the subscription", () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const subId = bus.subscribe("job.queued", handler);

    const event1 = createEvent(EventCategory.Job, "job.queued", "job_1");
    bus.publish(event1);
    expect(handler).toHaveBeenCalledOnce();

    bus.unsubscribe(subId);

    const event2 = createEvent(EventCategory.Job, "job.queued", "job_2");
    bus.publish(event2);
    expect(handler).toHaveBeenCalledOnce(); // Still only once
  });

  it("returns a subscription ID from subscribe", () => {
    const bus = new EventBus();
    const id = bus.subscribe("job.queued", () => {});
    expect(id).toContain("sub_");
  });

  it("handles unsubscribe with unknown ID gracefully", () => {
    const bus = new EventBus();
    expect(() => bus.unsubscribe("nonexistent")).not.toThrow();
  });

  it("delivers to wildcard and specific subscribers together", () => {
    const bus = new EventBus();
    const wildcardHandler = vi.fn();
    const specificHandler = vi.fn();

    bus.subscribe("*", wildcardHandler);
    bus.subscribe("session.started", specificHandler);

    const event = createEvent(EventCategory.Session, "session.started", "sess_1");
    bus.publish(event);

    expect(wildcardHandler).toHaveBeenCalledOnce();
    expect(specificHandler).toHaveBeenCalledOnce();
  });
});
