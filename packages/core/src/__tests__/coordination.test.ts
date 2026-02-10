import { describe, it, expect } from "vitest";
import {
  createLock,
  releaseLock,
  isLockExpired,
  isLockHeld,
  checkConflicts,
  generateWorkBranch,
  partitionByPath,
} from "../coordination.js";
import { LockType, createLockId, createJobId } from "../types.js";
import type { ResourceLock } from "../types.js";

function makeLock(overrides: Partial<ResourceLock> = {}): ResourceLock {
  return {
    id: createLockId("lock_test"),
    lockType: LockType.Repo,
    resource: "acme/backend",
    holderId: "agent_1",
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    released: false,
    ...overrides,
  };
}

describe("createLock", () => {
  it("produces a valid lock with correct fields", () => {
    const lock = createLock(LockType.Repo, "acme/backend", "agent_1", 60000);

    expect(lock.id).toBeTruthy();
    expect(typeof lock.id).toBe("string");
    expect(lock.lockType).toBe(LockType.Repo);
    expect(lock.resource).toBe("acme/backend");
    expect(lock.holderId).toBe("agent_1");
    expect(lock.released).toBe(false);
    expect(lock.acquiredAt).toBeTruthy();
    expect(lock.expiresAt).toBeTruthy();
  });

  it("generates unique IDs for different locks", () => {
    const lock1 = createLock(LockType.Repo, "acme/backend", "agent_1", 60000);
    const lock2 = createLock(LockType.Repo, "acme/backend", "agent_1", 60000);
    expect(lock1.id).not.toBe(lock2.id);
  });

  it("sets expiry based on duration", () => {
    const before = Date.now();
    const lock = createLock(LockType.Path, "src/index.ts", "agent_1", 30000);
    const after = Date.now();

    const expiresAt = new Date(lock.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30000);
    expect(expiresAt).toBeLessThanOrEqual(after + 30000);
  });
});

describe("releaseLock", () => {
  it("sets released to true", () => {
    const lock = createLock(LockType.Repo, "acme/backend", "agent_1", 60000);
    const released = releaseLock(lock);

    expect(released.released).toBe(true);
    expect(released.id).toBe(lock.id);
    // Original is unchanged (immutable)
    expect(lock.released).toBe(false);
  });
});

describe("isLockExpired", () => {
  it("returns false for a future expiry", () => {
    const lock = makeLock({ expiresAt: new Date(Date.now() + 60000).toISOString() });
    expect(isLockExpired(lock)).toBe(false);
  });

  it("returns true for a past expiry", () => {
    const lock = makeLock({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isLockExpired(lock)).toBe(true);
  });
});

describe("isLockHeld", () => {
  it("returns true for an active, unreleased lock", () => {
    const lock = makeLock();
    expect(isLockHeld(lock)).toBe(true);
  });

  it("returns false for a released lock", () => {
    const lock = makeLock({ released: true });
    expect(isLockHeld(lock)).toBe(false);
  });

  it("returns false for an expired lock", () => {
    const lock = makeLock({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isLockHeld(lock)).toBe(false);
  });
});

describe("checkConflicts", () => {
  it("returns no conflict when no active locks exist", () => {
    const result = checkConflicts("acme/backend", LockType.Repo, []);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictingLocks).toHaveLength(0);
  });

  it("detects repo-level conflict", () => {
    const activeLocks = [makeLock({ resource: "acme/backend", lockType: LockType.Repo })];
    const result = checkConflicts("acme/backend", LockType.Repo, activeLocks);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictingLocks).toHaveLength(1);
  });

  it("detects path conflict with overlapping paths", () => {
    const activeLocks = [makeLock({ resource: "src/", lockType: LockType.Path })];
    const result = checkConflicts("src/index.ts", LockType.Path, activeLocks);
    expect(result.hasConflict).toBe(true);
  });

  it("detects branch conflict on same branch", () => {
    const activeLocks = [makeLock({ resource: "main", lockType: LockType.Branch })];
    const result = checkConflicts("main", LockType.Branch, activeLocks);
    expect(result.hasConflict).toBe(true);
  });

  it("ignores released locks", () => {
    const activeLocks = [makeLock({ resource: "acme/backend", released: true })];
    const result = checkConflicts("acme/backend", LockType.Repo, activeLocks);
    expect(result.hasConflict).toBe(false);
  });

  it("ignores expired locks", () => {
    const activeLocks = [
      makeLock({
        resource: "acme/backend",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    const result = checkConflicts("acme/backend", LockType.Repo, activeLocks);
    expect(result.hasConflict).toBe(false);
  });

  it("includes holder info in conflict message", () => {
    const activeLocks = [makeLock({ resource: "acme/backend", holderId: "agent_42" })];
    const result = checkConflicts("acme/backend", LockType.Repo, activeLocks);
    expect(result.message).toContain("agent_42");
  });
});

describe("generateWorkBranch", () => {
  it("returns a valid branch strategy", () => {
    const jobId = createJobId("job_abc123def456");
    const result = generateWorkBranch(jobId, "main");

    expect(result.branchName).toBe("agentops/job_abc123de");
    expect(result.baseBranch).toBe("main");
    expect(result.jobId).toBe("job_abc123def456");
  });
});

describe("partitionByPath", () => {
  it("distributes paths across jobs", () => {
    const paths = ["a.ts", "b.ts", "c.ts", "d.ts"];
    const jobIds = [createJobId("job_1"), createJobId("job_2")];

    const result = partitionByPath(paths, jobIds);

    expect(result.partitions).toHaveLength(2);
    expect(result.partitions[0]!.paths).toEqual(["a.ts", "c.ts"]);
    expect(result.partitions[1]!.paths).toEqual(["b.ts", "d.ts"]);
    expect(result.unassigned).toEqual([]);
  });

  it("returns all paths as unassigned when no jobs", () => {
    const paths = ["a.ts", "b.ts"];
    const result = partitionByPath(paths, []);

    expect(result.partitions).toHaveLength(0);
    expect(result.unassigned).toEqual(["a.ts", "b.ts"]);
  });

  it("handles single job", () => {
    const paths = ["a.ts", "b.ts", "c.ts"];
    const jobIds = [createJobId("job_1")];

    const result = partitionByPath(paths, jobIds);

    expect(result.partitions).toHaveLength(1);
    expect(result.partitions[0]!.paths).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
