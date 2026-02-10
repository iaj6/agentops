import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import {
  insertLock,
  getLock,
  listLocks,
  updateLock,
  getActiveLocks,
  getActiveLocksForHolder,
  releaseLocksForHolder,
  releaseExpiredLocks,
} from "../locks.js";
import type { AgentOpsDb } from "../connection.js";
import type { ResourceLock } from "@agentops/core";
import { createLockId, LockType } from "@agentops/core";

function makeLock(id: string, overrides: Partial<ResourceLock> = {}): ResourceLock {
  return {
    id: createLockId(id),
    lockType: LockType.Repo,
    resource: "acme/backend",
    holderId: "agent_1",
    acquiredAt: "2025-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    released: false,
    ...overrides,
  };
}

describe("Locks repository", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("insertLock and getLock", () => {
    it("inserts and retrieves a lock", () => {
      const lock = makeLock("lock_1");
      insertLock(db, lock);

      const retrieved = getLock(db, createLockId("lock_1"));
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("lock_1");
      expect(retrieved!.lockType).toBe(LockType.Repo);
      expect(retrieved!.resource).toBe("acme/backend");
      expect(retrieved!.holderId).toBe("agent_1");
      expect(retrieved!.released).toBe(false);
    });

    it("returns null for non-existent lock", () => {
      const result = getLock(db, createLockId("nonexistent"));
      expect(result).toBeNull();
    });
  });

  describe("listLocks", () => {
    it("lists all locks ordered by acquiredAt descending", () => {
      insertLock(db, makeLock("lock_1", { acquiredAt: "2025-01-01T00:00:00.000Z" }));
      insertLock(db, makeLock("lock_2", { acquiredAt: "2025-01-02T00:00:00.000Z" }));
      insertLock(db, makeLock("lock_3", { acquiredAt: "2025-01-03T00:00:00.000Z" }));

      const results = listLocks(db);
      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe("lock_3");
      expect(results[1]!.id).toBe("lock_2");
      expect(results[2]!.id).toBe("lock_1");
    });

    it("filters by resource", () => {
      insertLock(db, makeLock("lock_1", { resource: "acme/backend" }));
      insertLock(db, makeLock("lock_2", { resource: "acme/frontend" }));

      const results = listLocks(db, { resource: "acme/backend" });
      expect(results).toHaveLength(1);
      expect(results[0]!.resource).toBe("acme/backend");
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertLock(db, makeLock(`lock_${i}`));
      }

      const results = listLocks(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("returns empty array when no locks match", () => {
      const results = listLocks(db, { resource: "nonexistent" });
      expect(results).toEqual([]);
    });
  });

  describe("updateLock", () => {
    it("updates released status", () => {
      insertLock(db, makeLock("lock_1"));

      updateLock(db, createLockId("lock_1"), { released: true });

      const updated = getLock(db, createLockId("lock_1"));
      expect(updated!.released).toBe(true);
    });

    it("does nothing when no updates provided", () => {
      insertLock(db, makeLock("lock_1"));
      const before = getLock(db, createLockId("lock_1"));

      updateLock(db, createLockId("lock_1"), {});

      const after = getLock(db, createLockId("lock_1"));
      expect(after!.released).toBe(before!.released);
    });
  });

  describe("getActiveLocks", () => {
    it("returns only active (unreleased, unexpired) locks for a resource", () => {
      insertLock(db, makeLock("lock_active", { resource: "acme/backend" }));
      insertLock(db, makeLock("lock_released", { resource: "acme/backend", released: true }));
      insertLock(db, makeLock("lock_expired", {
        resource: "acme/backend",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }));

      const results = getActiveLocks(db, "acme/backend");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("lock_active");
    });
  });

  describe("getActiveLocksForHolder", () => {
    it("returns active locks for a specific holder", () => {
      insertLock(db, makeLock("lock_1", { holderId: "agent_1" }));
      insertLock(db, makeLock("lock_2", { holderId: "agent_2" }));
      insertLock(db, makeLock("lock_3", { holderId: "agent_1", released: true }));

      const results = getActiveLocksForHolder(db, "agent_1");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("lock_1");
    });
  });

  describe("releaseLocksForHolder", () => {
    it("releases all active locks for a holder and returns count", () => {
      insertLock(db, makeLock("lock_1", { holderId: "agent_1" }));
      insertLock(db, makeLock("lock_2", { holderId: "agent_1" }));
      insertLock(db, makeLock("lock_3", { holderId: "agent_2" }));

      const count = releaseLocksForHolder(db, "agent_1");
      expect(count).toBe(2);

      const remaining = getActiveLocksForHolder(db, "agent_1");
      expect(remaining).toHaveLength(0);

      // agent_2's lock should be unaffected
      const agent2Locks = getActiveLocksForHolder(db, "agent_2");
      expect(agent2Locks).toHaveLength(1);
    });
  });

  describe("releaseExpiredLocks", () => {
    it("releases expired locks and returns count", () => {
      insertLock(db, makeLock("lock_active"));
      insertLock(db, makeLock("lock_expired_1", {
        expiresAt: "2020-01-01T00:00:00.000Z",
      }));
      insertLock(db, makeLock("lock_expired_2", {
        expiresAt: "2020-06-01T00:00:00.000Z",
      }));

      const count = releaseExpiredLocks(db);
      expect(count).toBe(2);

      const expired1 = getLock(db, createLockId("lock_expired_1"));
      expect(expired1!.released).toBe(true);

      // Active lock should be unaffected
      const active = getLock(db, createLockId("lock_active"));
      expect(active!.released).toBe(false);
    });
  });
});
