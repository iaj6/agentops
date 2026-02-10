"use client";

import type { ResourceLock } from "@agentops/core";
import { useLocks } from "@/hooks/useLocks";
import { LockBadge } from "@/components/LockBadge";
import { TimeAgo } from "@/components/TimeAgo";

function getLockStatus(lock: ResourceLock): "active" | "expired" | "released" {
  if (lock.released) return "released";
  if (new Date(lock.expiresAt) < new Date()) return "expired";
  return "active";
}

function LocksTable({ locks }: { locks: ResourceLock[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">ID</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Resource</th>
            <th className="px-4 py-3 font-medium">Holder</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Acquired</th>
            <th className="px-4 py-3 font-medium">Expires</th>
          </tr>
        </thead>
        <tbody>
          {locks.map((lock) => {
            const status = getLockStatus(lock);
            return (
              <tr
                key={lock.id as string}
                className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {(lock.id as string).slice(0, 16)}
                </td>
                <td className="px-4 py-3">
                  <LockBadge lockType={lock.lockType} />
                </td>
                <td className="px-4 py-3 font-mono text-xs">{lock.resource}</td>
                <td className="px-4 py-3 text-xs">{lock.holderId}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                      status === "active"
                        ? "bg-green/15 text-green border-green/30"
                        : status === "expired"
                          ? "bg-yellow/15 text-yellow border-yellow/30"
                          : "bg-muted/15 text-muted border-muted/30"
                    }`}
                  >
                    {status === "active" && (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
                      </span>
                    )}
                    {status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <TimeAgo date={lock.acquiredAt} />
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <TimeAgo date={lock.expiresAt} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RepoConflictMap({ locks }: { locks: ResourceLock[] }) {
  const activeLocks = locks.filter((l) => getLockStatus(l) === "active");
  const byResource = new Map<string, ResourceLock[]>();

  for (const lock of activeLocks) {
    const existing = byResource.get(lock.resource) ?? [];
    existing.push(lock);
    byResource.set(lock.resource, existing);
  }

  if (byResource.size === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No active locks
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from(byResource.entries()).map(([resource, resourceLocks]) => (
        <div
          key={resource}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
            </span>
            <span className="font-mono text-xs font-medium text-foreground">
              {resource}
            </span>
          </div>
          <div className="space-y-1">
            {resourceLocks.map((lock) => (
              <div key={lock.id as string} className="flex items-center justify-between text-xs">
                <span className="text-muted">{lock.holderId}</span>
                <LockBadge lockType={lock.lockType} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CoordinationView({ locks: initialLocks }: { locks: ResourceLock[] }) {
  const { locks } = useLocks(initialLocks);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">Active Resources</h2>
        <RepoConflictMap locks={locks} />
      </div>
      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">All Locks</h2>
        <LocksTable locks={locks} />
      </div>
    </div>
  );
}
