import type { ResourceLock, LockId, JobId } from "./types.js";
import { LockType, createLockId } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

let counter = 0;
function generateId(): string {
  counter++;
  return `lock_${Date.now()}_${counter}`;
}

// ─── Lock lifecycle ──────────────────────────────────────────────────────────

export function createLock(
  lockType: LockType,
  resource: string,
  holderId: string,
  durationMs: number,
): ResourceLock {
  const acquired = now();
  const expires = new Date(Date.now() + durationMs).toISOString();
  return {
    id: createLockId(generateId()),
    lockType,
    resource,
    holderId,
    acquiredAt: acquired,
    expiresAt: expires,
    released: false,
  };
}

export function releaseLock(lock: ResourceLock): ResourceLock {
  return {
    ...lock,
    released: true,
  };
}

export function isLockExpired(lock: ResourceLock): boolean {
  return new Date(lock.expiresAt).getTime() < Date.now();
}

export function isLockHeld(lock: ResourceLock): boolean {
  return !lock.released && !isLockExpired(lock);
}

// ─── Conflict detection ──────────────────────────────────────────────────────

export interface ConflictCheckResult {
  readonly hasConflict: boolean;
  readonly conflictingLocks: ReadonlyArray<ResourceLock>;
  readonly message: string;
}

export function checkConflicts(
  resource: string,
  lockType: LockType,
  activeLocks: ReadonlyArray<ResourceLock>,
): ConflictCheckResult {
  const conflicting = activeLocks.filter((lock) => {
    if (!isLockHeld(lock)) return false;

    if (lockType === LockType.Repo) {
      // Repo lock conflicts with any lock on the same repo
      return lock.resource === resource || lock.resource.startsWith(resource + "/");
    }

    if (lockType === LockType.Path) {
      // Path lock conflicts with repo lock on parent or path lock on same/overlapping path
      const lockRes = lock.resource.endsWith("/") ? lock.resource : lock.resource + "/";
      const checkRes = resource.endsWith("/") ? resource : resource + "/";
      return (
        lock.resource === resource ||
        resource.startsWith(lockRes) ||
        lock.resource.startsWith(checkRes)
      );
    }

    if (lockType === LockType.Branch) {
      // Branch lock conflicts with same branch
      return lock.resource === resource;
    }

    return false;
  });

  if (conflicting.length === 0) {
    return {
      hasConflict: false,
      conflictingLocks: [],
      message: `No conflicts for ${lockType} lock on ${resource}`,
    };
  }

  const holders = [...new Set(conflicting.map((l) => l.holderId))].join(", ");
  return {
    hasConflict: true,
    conflictingLocks: conflicting,
    message: `Conflict: ${resource} is locked by ${holders}`,
  };
}

// ─── Branch isolation ────────────────────────────────────────────────────────

export interface BranchStrategy {
  readonly branchName: string;
  readonly baseBranch: string;
  readonly jobId: string;
}

export function generateWorkBranch(jobId: JobId, baseBranch: string): BranchStrategy {
  const shortId = (jobId as string).slice(0, 12);
  return {
    branchName: `agentops/${shortId}`,
    baseBranch,
    jobId: jobId as string,
  };
}

// ─── Work partitioning ──────────────────────────────────────────────────────

export interface PathPartition {
  readonly jobId: string;
  readonly paths: ReadonlyArray<string>;
}

export interface PartitionStrategy {
  readonly partitions: ReadonlyArray<PathPartition>;
  readonly unassigned: ReadonlyArray<string>;
}

export function partitionByPath(
  paths: ReadonlyArray<string>,
  jobIds: ReadonlyArray<JobId>,
): PartitionStrategy {
  if (jobIds.length === 0) {
    return {
      partitions: [],
      unassigned: paths,
    };
  }

  const partitions: PathPartition[] = jobIds.map((id) => ({
    jobId: id as string,
    paths: [] as string[],
  }));

  const unassigned: string[] = [];

  for (let i = 0; i < paths.length; i++) {
    const partition = partitions[i % jobIds.length]!;
    (partition.paths as string[]).push(paths[i]!);
  }

  return { partitions, unassigned };
}
