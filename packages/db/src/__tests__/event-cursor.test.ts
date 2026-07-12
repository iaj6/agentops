import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import { insertEvent, listEvents } from "../events.js";
import {
  createEventPollCursor,
  advanceEventPollCursor,
  type EventPollCursor,
} from "../event-cursor.js";
import type { AgentEvent } from "@agentops/core";
import { createEventId, EventCategory } from "@agentops/core";

function makeEvent(id: string, timestamp: string, overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: createEventId(id),
    category: EventCategory.Job,
    type: "job.queued",
    payload: { jobId: "job_1" },
    sourceId: "job_1",
    timestamp,
    ...overrides,
  };
}

describe("event poll cursor", () => {
  describe("advanceEventPollCursor (pure)", () => {
    it("returns fresh events oldest-first from a newest-first batch", () => {
      const cursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const batch = [
        makeEvent("evt_2", "2025-01-01T00:00:02.000Z"),
        makeEvent("evt_1", "2025-01-01T00:00:01.000Z"),
      ];

      const { fresh } = advanceEventPollCursor(cursor, batch);
      expect(fresh.map((e) => e.id)).toEqual(["evt_1", "evt_2"]);
    });

    it("keeps the cursor unchanged on an empty batch", () => {
      const cursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const { fresh, next } = advanceEventPollCursor(cursor, []);
      expect(fresh).toEqual([]);
      expect(next).toBe(cursor);
    });

    it("does not re-emit the boundary event on the next poll", () => {
      let cursor: EventPollCursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const evt = makeEvent("evt_1", "2025-01-01T00:00:01.000Z");

      const first = advanceEventPollCursor(cursor, [evt]);
      expect(first.fresh).toHaveLength(1);
      cursor = first.next;

      // A gte query re-matches evt_1 on every subsequent poll.
      const second = advanceEventPollCursor(cursor, [evt]);
      expect(second.fresh).toHaveLength(0);
      expect(second.next).toBe(cursor);
    });

    it("emits a later event that shares the boundary timestamp exactly once", () => {
      const ts = "2025-01-01T00:00:01.000Z";
      let cursor: EventPollCursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const evtA = makeEvent("evt_a", ts);
      const evtB = makeEvent("evt_b", ts);

      // Poll 1: only evt_a exists yet.
      const first = advanceEventPollCursor(cursor, [evtA]);
      expect(first.fresh.map((e) => e.id)).toEqual(["evt_a"]);
      cursor = first.next;

      // Poll 2: evt_b arrived with the SAME timestamp. A bare gt cursor
      // would drop it; gte + seen-ID tracking emits it once.
      const second = advanceEventPollCursor(cursor, [evtB, evtA]);
      expect(second.fresh.map((e) => e.id)).toEqual(["evt_b"]);
      cursor = second.next;

      // Poll 3: nothing new — neither re-emits.
      const third = advanceEventPollCursor(cursor, [evtB, evtA]);
      expect(third.fresh).toHaveLength(0);
    });

    it("clears boundary IDs once the boundary advances past them", () => {
      let cursor: EventPollCursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const evtA = makeEvent("evt_a", "2025-01-01T00:00:01.000Z");
      cursor = advanceEventPollCursor(cursor, [evtA]).next;

      const evtB = makeEvent("evt_b", "2025-01-01T00:00:02.000Z");
      cursor = advanceEventPollCursor(cursor, [evtB, evtA]).next;

      expect(cursor.since).toBe("2025-01-01T00:00:02.000Z");
      expect(cursor.seenIdsAtBoundary.has("evt_b")).toBe(true);
      expect(cursor.seenIdsAtBoundary.has("evt_a")).toBe(false);
    });
  });

  describe("integration with listEvents polling", () => {
    let db: AgentOpsDb;

    beforeEach(() => {
      db = getDb(":memory:");
    });

    function poll(cursor: EventPollCursor) {
      const batch = listEvents(db, { since: cursor.since, limit: 100 });
      return advanceEventPollCursor(cursor, batch);
    }

    it("emits each event exactly once across repeated polls", () => {
      let cursor = createEventPollCursor("2025-01-01T00:00:00.000Z");
      const emitted: string[] = [];

      insertEvent(db, makeEvent("evt_1", "2025-01-01T00:00:01.000Z"));

      // Several idle polls after the first event — the old timestamp-only
      // cursor re-emitted the newest event on every one of these.
      for (let i = 0; i < 3; i++) {
        const { fresh, next } = poll(cursor);
        emitted.push(...fresh.map((e) => e.id as string));
        cursor = next;
      }
      expect(emitted).toEqual(["evt_1"]);

      // Two more events, one sharing the boundary timestamp.
      insertEvent(db, makeEvent("evt_2", "2025-01-01T00:00:01.000Z"));
      insertEvent(db, makeEvent("evt_3", "2025-01-01T00:00:05.000Z"));

      for (let i = 0; i < 3; i++) {
        const { fresh, next } = poll(cursor);
        emitted.push(...fresh.map((e) => e.id as string));
        cursor = next;
      }
      expect(emitted).toEqual(["evt_1", "evt_2", "evt_3"]);
    });
  });
});
