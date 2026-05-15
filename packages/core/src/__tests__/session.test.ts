import { describe, it, expect } from "vitest";
import {
  createSession,
  activateSession,
  assignRun,
  completeSessionRun,
  updateHeartbeat,
  updateResourceUsage,
  terminateSession,
  isStaleSession,
  STALE_THRESHOLD_MS,
} from "../session.js";
import { SessionStatus, createRunId } from "../types.js";
import type { Session, ResourceUsage } from "../types.js";

describe("createSession", () => {
  it("produces a valid initial Session with Provisioning status", () => {
    const session = createSession("agent_1");

    expect(session.id).toBeTruthy();
    expect(typeof session.id).toBe("string");
    expect(session.status).toBe(SessionStatus.Provisioning);
    expect(session.agentId).toBe("agent_1");
    expect(session.currentRunId).toBeNull();
    expect(session.completedRunIds).toEqual([]);
    expect(session.resourceUsage).toEqual({
      memoryMb: 0,
      cpuPercent: 0,
      tokensBudgetRemaining: 0,
      costBudgetRemaining: 0,
    });
    expect(session.metadata).toEqual({});
    expect(session.startedAt).toBeTruthy();
    expect(session.lastHeartbeatAt).toBeTruthy();
    expect(session.terminatedAt).toBeNull();
    expect(session.createdAt).toBeTruthy();
    expect(session.updatedAt).toBeTruthy();
  });

  it("generates unique IDs for different sessions", () => {
    const s1 = createSession("agent_1");
    const s2 = createSession("agent_2");
    expect(s1.id).not.toBe(s2.id);
  });

  it("accepts optional metadata", () => {
    const session = createSession("agent_1", { env: "production" });
    expect(session.metadata).toEqual({ env: "production" });
  });
});

describe("activateSession", () => {
  it("sets status to Active", () => {
    const session = createSession("agent_1");
    const activated = activateSession(session);

    expect(activated.status).toBe(SessionStatus.Active);
    expect(activated.id).toBe(session.id);
  });
});

describe("assignRun", () => {
  it("sets the currentRunId", () => {
    const session = activateSession(createSession("agent_1"));
    const runId = createRunId("run_1");
    const assigned = assignRun(session, runId);

    expect(assigned.currentRunId).toBe(runId);
    // Original is unchanged (immutable)
    expect(session.currentRunId).toBeNull();
  });
});

describe("completeSessionRun", () => {
  it("moves currentRunId to completedRunIds and clears currentRunId", () => {
    const runId = createRunId("run_1");
    let session = activateSession(createSession("agent_1"));
    session = assignRun(session, runId);
    const completed = completeSessionRun(session);

    expect(completed.currentRunId).toBeNull();
    expect(completed.completedRunIds).toContain(runId);
    expect(completed.completedRunIds).toHaveLength(1);
  });

  it("handles completeSessionRun when no current run is assigned", () => {
    const session = activateSession(createSession("agent_1"));
    const completed = completeSessionRun(session);

    expect(completed.currentRunId).toBeNull();
    expect(completed.completedRunIds).toEqual([]);
  });

  it("accumulates completed runs", () => {
    let session = activateSession(createSession("agent_1"));

    session = assignRun(session, createRunId("run_1"));
    session = completeSessionRun(session);
    session = assignRun(session, createRunId("run_2"));
    session = completeSessionRun(session);

    expect(session.completedRunIds).toHaveLength(2);
  });
});

describe("updateHeartbeat", () => {
  it("updates lastHeartbeatAt", () => {
    const session = createSession("agent_1");
    const updated = updateHeartbeat(session);

    expect(updated.lastHeartbeatAt).toBeTruthy();
    expect(updated.id).toBe(session.id);
  });
});

describe("updateResourceUsage", () => {
  it("sets resource usage", () => {
    const session = createSession("agent_1");
    const usage: ResourceUsage = {
      memoryMb: 512,
      cpuPercent: 45.2,
      tokensBudgetRemaining: 100000,
      costBudgetRemaining: 5.0,
    };
    const updated = updateResourceUsage(session, usage);

    expect(updated.resourceUsage).toEqual(usage);
    // Original is unchanged
    expect(session.resourceUsage.memoryMb).toBe(0);
  });
});

describe("terminateSession", () => {
  it("sets status to Terminated and sets terminatedAt", () => {
    const session = activateSession(createSession("agent_1"));
    const terminated = terminateSession(session);

    expect(terminated.status).toBe(SessionStatus.Terminated);
    expect(terminated.terminatedAt).toBeTruthy();
  });
});

describe("isStaleSession", () => {
  it("returns false for a fresh active session", () => {
    const session = activateSession(createSession("agent_1"));
    expect(isStaleSession(session)).toBe(false);
  });

  it("returns true when lastHeartbeatAt is older than the threshold", () => {
    const old = new Date(Date.now() - STALE_THRESHOLD_MS - 60_000).toISOString();
    const session: Session = {
      ...activateSession(createSession("agent_1")),
      lastHeartbeatAt: old,
    };
    expect(isStaleSession(session)).toBe(true);
  });

  it("never marks a terminated session as stale", () => {
    const old = new Date(Date.now() - STALE_THRESHOLD_MS - 60_000).toISOString();
    const session: Session = {
      ...terminateSession(activateSession(createSession("agent_1"))),
      lastHeartbeatAt: old,
    };
    expect(isStaleSession(session)).toBe(false);
  });

  it("respects a custom threshold", () => {
    const session: Session = {
      ...activateSession(createSession("agent_1")),
      lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
    };
    expect(isStaleSession(session, 1_000)).toBe(true);
    expect(isStaleSession(session, 10_000)).toBe(false);
  });
});
