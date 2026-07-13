import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertEvent, getEvent, listEvents, countEvents, getEventsBySource, getRecentEvents } from "../events.js";
import type { AgentOpsDb } from "../connection.js";
import type { AgentEvent } from "@agentops/core";
import { createEventId, EventCategory } from "@agentops/core";

function makeEvent(id: string, overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: createEventId(id),
    category: EventCategory.Run,
    type: "run.started",
    payload: { jobId: "run_1" },
    sourceId: "run_1",
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Events repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertEvent and getEvent", () => {
    it("inserts and retrieves an event", () => {
      const event = makeEvent("evt_1");
      insertEvent(db, event);

      const retrieved = getEvent(db, createEventId("evt_1"));
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("evt_1");
      expect(retrieved!.category).toBe(EventCategory.Run);
      expect(retrieved!.type).toBe("run.started");
      expect(retrieved!.sourceId).toBe("run_1");
      expect(retrieved!.payload).toEqual({ jobId: "run_1" });
    });

    it("returns null for non-existent event", () => {
      const result = getEvent(db, createEventId("nonexistent"));
      expect(result).toBeNull();
    });
  });

  describe("listEvents", () => {
    it("lists all events ordered by timestamp descending", () => {
      insertEvent(db, makeEvent("evt_1", { timestamp: "2025-01-01T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_2", { timestamp: "2025-01-02T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_3", { timestamp: "2025-01-03T00:00:00.000Z" }));

      const results = listEvents(db);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("evt_3");
      expect(results[1]!.id).toBe("evt_2");
      expect(results[2]!.id).toBe("evt_1");
    });

    it("filters by category", () => {
      insertEvent(db, makeEvent("evt_1", { category: EventCategory.Run }));
      insertEvent(db, makeEvent("evt_2", { category: EventCategory.Session }));
      insertEvent(db, makeEvent("evt_3", { category: EventCategory.Run }));

      const results = listEvents(db, { category: "run" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.category === EventCategory.Run)).toBe(true);
    });

    it("filters by type", () => {
      insertEvent(db, makeEvent("evt_1", { type: "run.started" }));
      insertEvent(db, makeEvent("evt_2", { type: "job.completed" }));
      insertEvent(db, makeEvent("evt_3", { type: "run.started" }));

      const results = listEvents(db, { type: "run.started" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.type === "run.started")).toBe(true);
    });

    it("filters by sourceId", () => {
      insertEvent(db, makeEvent("evt_1", { sourceId: "run_1" }));
      insertEvent(db, makeEvent("evt_2", { sourceId: "run_2" }));
      insertEvent(db, makeEvent("evt_3", { sourceId: "run_1" }));

      const results = listEvents(db, { sourceId: "run_1" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.sourceId === "run_1")).toBe(true);
    });

    it("filters by since timestamp", () => {
      insertEvent(db, makeEvent("evt_1", { timestamp: "2025-01-01T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_2", { timestamp: "2025-01-05T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_3", { timestamp: "2025-01-10T00:00:00.000Z" }));

      const results = listEvents(db, { since: "2025-01-04T00:00:00.000Z" });
      expect(results).toHaveLength(2);
    });

    it("since is inclusive of the boundary timestamp", () => {
      // Poll cursors (SSE route, CLI tail) rely on gte semantics so a
      // second event sharing the boundary timestamp is never dropped.
      insertEvent(db, makeEvent("evt_1", { timestamp: "2025-01-05T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_2", { timestamp: "2025-01-06T00:00:00.000Z" }));

      const results = listEvents(db, { since: "2025-01-05T00:00:00.000Z" });
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toContain("evt_1");
    });

    it("filters by until timestamp", () => {
      insertEvent(db, makeEvent("evt_1", { timestamp: "2025-01-01T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_2", { timestamp: "2025-01-05T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_3", { timestamp: "2025-01-10T00:00:00.000Z" }));

      const results = listEvents(db, { until: "2025-01-06T00:00:00.000Z" });
      expect(results).toHaveLength(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertEvent(db, makeEvent(`evt_${i}`, {
          timestamp: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        }));
      }

      const results = listEvents(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("returns empty array when no events match", () => {
      const results = listEvents(db, { category: "session" });
      expect(results).toEqual([]);
    });
  });

  describe("countEvents", () => {
    it("counts all events", () => {
      insertEvent(db, makeEvent("evt_1"));
      insertEvent(db, makeEvent("evt_2"));
      insertEvent(db, makeEvent("evt_3"));

      expect(countEvents(db)).toBe(3);
    });

    it("counts events with filters", () => {
      insertEvent(db, makeEvent("evt_1", { category: EventCategory.Run }));
      insertEvent(db, makeEvent("evt_2", { category: EventCategory.Session }));
      insertEvent(db, makeEvent("evt_3", { category: EventCategory.Run }));

      expect(countEvents(db, { category: "run" })).toBe(2);
    });
  });

  describe("getEventsBySource", () => {
    it("returns events for a specific source", () => {
      insertEvent(db, makeEvent("evt_1", { sourceId: "run_1" }));
      insertEvent(db, makeEvent("evt_2", { sourceId: "run_2" }));
      insertEvent(db, makeEvent("evt_3", { sourceId: "run_1" }));

      const results = getEventsBySource(db, "run_1");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.sourceId === "run_1")).toBe(true);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        insertEvent(db, makeEvent(`evt_${i}`, {
          sourceId: "run_1",
          timestamp: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        }));
      }

      const results = getEventsBySource(db, "run_1", 3);
      expect(results).toHaveLength(3);
    });
  });

  describe("getRecentEvents", () => {
    it("returns most recent events", () => {
      insertEvent(db, makeEvent("evt_1", { timestamp: "2025-01-01T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_2", { timestamp: "2025-01-03T00:00:00.000Z" }));
      insertEvent(db, makeEvent("evt_3", { timestamp: "2025-01-02T00:00:00.000Z" }));

      const results = getRecentEvents(db, 2);
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("evt_2");
      expect(results[1]!.id).toBe("evt_3");
    });
  });
});
