import { describe, it, expect, beforeEach } from "vitest";
import { getDb, type AgentOpsDb } from "../connection.js";
import { insertAuditLog, listAuditLogs, countAuditLogs } from "../audit.js";

let db: AgentOpsDb;

beforeEach(() => {
  db = getDb(":memory:");
});

describe("insertAuditLog", () => {
  it("round-trips a minimal row through listAuditLogs", () => {
    const entry = insertAuditLog(db, { action: "user.login" });
    expect(entry).not.toBeNull();
    const rows = listAuditLogs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(entry!.id);
    expect(rows[0]!.action).toBe("user.login");
    expect(rows[0]!.userId).toBeNull();
    expect(rows[0]!.metadata).toBeNull();
  });

  it("persists every column", () => {
    insertAuditLog(db, {
      userId: "user_abc",
      action: "policy.updated",
      targetType: "policy",
      targetId: "pol_xyz",
      ip: "10.0.0.5",
      metadata: { fields: ["name", "severity"], byEmail: "ian@example.com" },
    });
    const [row] = listAuditLogs(db);
    expect(row!.userId).toBe("user_abc");
    expect(row!.action).toBe("policy.updated");
    expect(row!.targetType).toBe("policy");
    expect(row!.targetId).toBe("pol_xyz");
    expect(row!.ip).toBe("10.0.0.5");
    expect(row!.metadata).toEqual({
      fields: ["name", "severity"],
      byEmail: "ian@example.com",
    });
  });

  it("uses a unique id per insert", () => {
    const a = insertAuditLog(db, { action: "user.login" });
    const b = insertAuditLog(db, { action: "user.login" });
    expect(a!.id).not.toBe(b!.id);
  });

  it("honors a caller-supplied timestamp (useful for tests)", () => {
    insertAuditLog(db, {
      action: "user.login",
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    const [row] = listAuditLogs(db);
    expect(row!.timestamp).toBe("2025-01-01T00:00:00.000Z");
  });
});

describe("listAuditLogs", () => {
  beforeEach(() => {
    // Three entries across two users + two actions across a 1-second
    // window so DESC ordering is deterministic without sleep().
    insertAuditLog(db, {
      action: "user.login",
      userId: "alice",
      timestamp: "2026-05-15T10:00:00.000Z",
    });
    insertAuditLog(db, {
      action: "policy.toggled",
      userId: "alice",
      timestamp: "2026-05-15T10:00:01.000Z",
    });
    insertAuditLog(db, {
      action: "user.login",
      userId: "bob",
      timestamp: "2026-05-15T10:00:02.000Z",
    });
  });

  it("returns rows newest-first", () => {
    const rows = listAuditLogs(db);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.userId).toBe("bob");
    expect(rows[2]!.userId).toBe("alice");
    expect(rows[2]!.action).toBe("user.login");
  });

  it("filters by action", () => {
    const rows = listAuditLogs(db, { action: "user.login" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "user.login")).toBe(true);
  });

  it("filters by userId", () => {
    const rows = listAuditLogs(db, { userId: "alice" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === "alice")).toBe(true);
  });

  it("combines action + userId filters", () => {
    const rows = listAuditLogs(db, { action: "user.login", userId: "alice" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("user.login");
    expect(rows[0]!.userId).toBe("alice");
  });

  it("respects since/until window", () => {
    const rows = listAuditLogs(db, {
      since: "2026-05-15T10:00:01.000Z",
      until: "2026-05-15T10:00:01.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("policy.toggled");
  });

  it("respects limit + offset for pagination", () => {
    const page1 = listAuditLogs(db, { limit: 2, offset: 0 });
    const page2 = listAuditLogs(db, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });
});

describe("countAuditLogs", () => {
  it("counts unfiltered", () => {
    insertAuditLog(db, { action: "user.login" });
    insertAuditLog(db, { action: "user.logout" });
    expect(countAuditLogs(db)).toBe(2);
  });

  it("counts with action filter", () => {
    insertAuditLog(db, { action: "user.login", userId: "alice" });
    insertAuditLog(db, { action: "user.login", userId: "bob" });
    insertAuditLog(db, { action: "user.logout", userId: "alice" });
    expect(countAuditLogs(db, { action: "user.login" })).toBe(2);
    expect(countAuditLogs(db, { userId: "alice" })).toBe(2);
    expect(countAuditLogs(db, { action: "user.login", userId: "alice" })).toBe(1);
  });
});
