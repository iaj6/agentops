import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertSession, getSession, listSessions, updateSession, getActiveSessions, countActiveSessions, getStaleSessions } from "../sessions.js";
import type { AgentOpsDb } from "../connection.js";
import type { Session } from "@agentops/core";
import { createSessionId, createAgentId, SessionStatus } from "@agentops/core";

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id: createSessionId(id),
    status: SessionStatus.Active,
    agentId: createAgentId("agent_1"),
    currentRunId: null,
    completedRunIds: [],
    resourceUsage: {
      memoryMb: 256,
      cpuPercent: 25.0,
      tokensBudgetRemaining: 50000,
      costBudgetRemaining: 10.0,
    },
    metadata: {},
    startedAt: "2025-01-01T00:00:00.000Z",
    lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
    terminatedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Sessions repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertSession and getSession", () => {
    it("inserts and retrieves a session", () => {
      const session = makeSession("sess_1");
      insertSession(db, session);

      const retrieved = getSession(db, createSessionId("sess_1"));
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("sess_1");
      expect(retrieved!.status).toBe(SessionStatus.Active);
      expect(retrieved!.agentId).toBe("agent_1");
      expect(retrieved!.resourceUsage.memoryMb).toBe(256);
    });

    it("returns null for non-existent session", () => {
      const result = getSession(db, createSessionId("nonexistent"));
      expect(result).toBeNull();
    });

    it("preserves complex nested data", () => {
      const session = makeSession("sess_complex", {
        metadata: { env: "production", tags: ["gpu", "large"] },
        completedRunIds: ["run_1" as any, "run_2" as any],
      });

      insertSession(db, session);
      const retrieved = getSession(db, createSessionId("sess_complex"));

      expect(retrieved!.metadata).toEqual({ env: "production", tags: ["gpu", "large"] });
      expect(retrieved!.completedRunIds).toHaveLength(2);
    });
  });

  describe("listSessions", () => {
    it("lists all sessions ordered by createdAt descending", () => {
      insertSession(db, makeSession("sess_1", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertSession(db, makeSession("sess_2", { createdAt: "2025-01-02T00:00:00.000Z" }));
      insertSession(db, makeSession("sess_3", { createdAt: "2025-01-03T00:00:00.000Z" }));

      const results = listSessions(db);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("sess_3");
      expect(results[1]!.id).toBe("sess_2");
      expect(results[2]!.id).toBe("sess_1");
    });

    it("filters by status", () => {
      insertSession(db, makeSession("sess_1", { status: SessionStatus.Active }));
      insertSession(db, makeSession("sess_2", { status: SessionStatus.Terminated }));
      insertSession(db, makeSession("sess_3", { status: SessionStatus.Active }));

      const results = listSessions(db, { status: "active" });
      expect(results).toHaveLength(2);
      expect(results.every((s) => s.status === SessionStatus.Active)).toBe(true);
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertSession(db, makeSession(`sess_${i}`, { createdAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
      }

      const results = listSessions(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("returns empty array when no sessions match", () => {
      const results = listSessions(db, { status: "terminated" });
      expect(results).toEqual([]);
    });
  });

  describe("updateSession", () => {
    it("updates session status", () => {
      insertSession(db, makeSession("sess_1", { status: SessionStatus.Active }));

      updateSession(db, createSessionId("sess_1"), {
        status: SessionStatus.Terminated,
        updatedAt: "2025-01-02T00:00:00.000Z",
      });

      const updated = getSession(db, createSessionId("sess_1"));
      expect(updated!.status).toBe(SessionStatus.Terminated);
      expect(updated!.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    });

    it("does nothing when no updates provided", () => {
      insertSession(db, makeSession("sess_1"));
      const before = getSession(db, createSessionId("sess_1"));

      updateSession(db, createSessionId("sess_1"), {});

      const after = getSession(db, createSessionId("sess_1"));
      expect(after!.updatedAt).toBe(before!.updatedAt);
    });
  });

  describe("getActiveSessions", () => {
    it("returns only active sessions", () => {
      insertSession(db, makeSession("sess_1", { status: SessionStatus.Active }));
      insertSession(db, makeSession("sess_2", { status: SessionStatus.Terminated }));
      insertSession(db, makeSession("sess_3", { status: SessionStatus.Active }));
      insertSession(db, makeSession("sess_4", { status: SessionStatus.Provisioning }));

      const active = getActiveSessions(db);
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.status === SessionStatus.Active)).toBe(true);
    });
  });

  describe("countActiveSessions", () => {
    it("counts active sessions", () => {
      insertSession(db, makeSession("sess_1", { status: SessionStatus.Active }));
      insertSession(db, makeSession("sess_2", { status: SessionStatus.Terminated }));
      insertSession(db, makeSession("sess_3", { status: SessionStatus.Active }));

      expect(countActiveSessions(db)).toBe(2);
    });

    it("returns 0 when no active sessions", () => {
      insertSession(db, makeSession("sess_1", { status: SessionStatus.Terminated }));
      expect(countActiveSessions(db)).toBe(0);
    });
  });

  describe("getStaleSessions", () => {
    it("returns active sessions with heartbeat older than threshold", () => {
      insertSession(db, makeSession("sess_1", {
        status: SessionStatus.Active,
        lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
      }));
      insertSession(db, makeSession("sess_2", {
        status: SessionStatus.Active,
        lastHeartbeatAt: "2025-01-10T00:00:00.000Z",
      }));
      insertSession(db, makeSession("sess_3", {
        status: SessionStatus.Terminated,
        lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
      }));

      const stale = getStaleSessions(db, "2025-01-05T00:00:00.000Z");
      expect(stale).toHaveLength(1);
      expect(stale[0]!.id).toBe("sess_1");
    });
  });
});
