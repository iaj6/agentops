import { describe, it, expect } from "vitest";
import { createEventId, EventCategory, type AgentEvent } from "@agentops/core";
import { applyLiveEvent, type LiveEventState } from "@/lib/live-events";

function makeEvent(id: string): AgentEvent {
  return {
    id: createEventId(id),
    category: EventCategory.Run,
    type: "run.started",
    payload: {},
    sourceId: "run_1",
    timestamp: "2025-01-01T00:00:00.000Z",
  };
}

describe("applyLiveEvent", () => {
  it("prepends a new event and increments the total", () => {
    const state: LiveEventState = { events: [makeEvent("evt_1")], total: 10 };
    const next = applyLiveEvent(state, makeEvent("evt_2"));

    expect(next.events.map((e) => e.id as string)).toEqual(["evt_2", "evt_1"]);
    expect(next.total).toBe(11);
  });

  it("does not inflate the total when the event is a duplicate", () => {
    const state: LiveEventState = { events: [makeEvent("evt_1")], total: 10 };

    // The SSE server used to redeliver the newest event every 2s poll;
    // the counter must not creep even if a duplicate slips through again.
    let next = applyLiveEvent(state, makeEvent("evt_1"));
    next = applyLiveEvent(next, makeEvent("evt_1"));

    expect(next).toBe(state);
    expect(next.total).toBe(10);
    expect(next.events).toHaveLength(1);
  });

  it("starts counting from an empty state", () => {
    const empty: LiveEventState = { events: [], total: 0 };
    const next = applyLiveEvent(empty, makeEvent("evt_1"));
    expect(next.events).toHaveLength(1);
    expect(next.total).toBe(1);
  });
});
