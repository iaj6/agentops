"use client";

import { useState, useCallback } from "react";
import type { ResourceLock } from "@agentops/core";
import { LockType } from "@agentops/core";
import { useLocks } from "@/hooks/useLocks";
import { LockBadge } from "@/components/LockBadge";
import { TimeAgo } from "@/components/TimeAgo";

function getLockStatus(lock: ResourceLock): "active" | "expired" | "released" {
  if (lock.released) return "released";
  if (new Date(lock.expiresAt) < new Date()) return "expired";
  return "active";
}

function formatDuration(from: string): string {
  const ms = Date.now() - new Date(from).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function LocksTable({
  locks,
  recentlyUpdated,
  onRelease,
}: {
  locks: ResourceLock[];
  recentlyUpdated: Set<string>;
  onRelease: (id: string) => void;
}) {
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
            <th className="px-4 py-3 font-medium">Held for</th>
            <th className="px-4 py-3 font-medium">Acquired</th>
            <th className="px-4 py-3 font-medium">Expires</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {locks.map((lock) => {
            const status = getLockStatus(lock);
            const isHighlighted = recentlyUpdated.has(lock.id as string);
            return (
              <tr
                key={lock.id as string}
                className={`border-b border-border last:border-0 transition-colors duration-500 ${
                  isHighlighted ? "bg-accent/10" : "hover:bg-surface-2"
                }`}
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
                <td className="px-4 py-3 text-xs text-muted font-mono">
                  {status === "active" ? formatDuration(lock.acquiredAt) : "--"}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <TimeAgo date={lock.acquiredAt} />
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  <TimeAgo date={lock.expiresAt} />
                </td>
                <td className="px-4 py-3">
                  {status === "active" && (
                    <button
                      onClick={() => onRelease(lock.id as string)}
                      className="rounded border border-red/30 bg-red/10 px-2 py-1 text-xs font-medium text-red hover:bg-red/20 transition-colors"
                    >
                      Release
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`h-4 w-4 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <span className="rounded-full bg-muted/15 px-2 py-0.5 text-xs text-muted">{count}</span>
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}

function RepoConflictMap({
  locks,
  recentlyUpdated,
}: {
  locks: ResourceLock[];
  recentlyUpdated: Set<string>;
}) {
  const activeLocks = locks.filter((l) => getLockStatus(l) === "active");

  // Group by lock type
  const byType = new Map<string, ResourceLock[]>();
  for (const lock of activeLocks) {
    const existing = byType.get(lock.lockType) ?? [];
    existing.push(lock);
    byType.set(lock.lockType, existing);
  }

  // Detect conflicts: multiple active locks on same resource
  const resourceCounts = new Map<string, number>();
  for (const lock of activeLocks) {
    resourceCounts.set(lock.resource, (resourceCounts.get(lock.resource) ?? 0) + 1);
  }
  const conflictResources = new Set(
    Array.from(resourceCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([resource]) => resource)
  );

  if (activeLocks.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No active locks
      </div>
    );
  }

  const typeLabels: Record<string, string> = {
    [LockType.Repo]: "Repo Locks",
    [LockType.Path]: "Path Locks",
    [LockType.Branch]: "Branch Locks",
  };

  const typeOrder = [LockType.Repo, LockType.Path, LockType.Branch];

  return (
    <div className="space-y-3">
      {conflictResources.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow/30 bg-yellow/10 px-4 py-2">
          <svg className="h-4 w-4 text-yellow" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-xs font-medium text-yellow">
            Conflict detected: {conflictResources.size} resource{conflictResources.size > 1 ? "s have" : " has"} multiple active locks
          </span>
        </div>
      )}

      {typeOrder.map((lockType) => {
        const typeLocks = byType.get(lockType);
        if (!typeLocks || typeLocks.length === 0) return null;

        // Group by resource within type
        const byResource = new Map<string, ResourceLock[]>();
        for (const lock of typeLocks) {
          const existing = byResource.get(lock.resource) ?? [];
          existing.push(lock);
          byResource.set(lock.resource, existing);
        }

        return (
          <CollapsibleSection
            key={lockType}
            title={typeLabels[lockType] ?? lockType}
            count={typeLocks.length}
            defaultOpen={true}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from(byResource.entries()).map(([resource, resourceLocks]) => {
                const hasConflict = conflictResources.has(resource);
                return (
                  <div
                    key={resource}
                    className={`rounded-lg border p-4 ${
                      hasConflict
                        ? "border-yellow/40 bg-yellow/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span
                          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                            hasConflict ? "bg-yellow" : "bg-green"
                          }`}
                        />
                        <span
                          className={`relative inline-flex h-2 w-2 rounded-full ${
                            hasConflict ? "bg-yellow" : "bg-green"
                          }`}
                        />
                      </span>
                      <span className="font-mono text-xs font-medium text-foreground">
                        {resource}
                      </span>
                      {hasConflict && (
                        <span className="rounded-full border border-yellow/30 bg-yellow/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow">
                          CONFLICT
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {resourceLocks.map((lock) => {
                        const isHighlighted = recentlyUpdated.has(lock.id as string);
                        return (
                          <div
                            key={lock.id as string}
                            className={`flex items-center justify-between text-xs transition-colors duration-500 ${
                              isHighlighted ? "text-accent" : ""
                            }`}
                          >
                            <span className="text-muted">{lock.holderId}</span>
                            <span className="font-mono text-muted/70">{formatDuration(lock.acquiredAt)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

export function CoordinationView({ locks: initialLocks }: { locks: ResourceLock[] }) {
  const { locks, recentlyUpdated, refresh } = useLocks(initialLocks);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);

  const handleRelease = useCallback(
    async (id: string) => {
      setReleasing(id);
      try {
        const res = await fetch(`/api/locks/${id}`, { method: "DELETE" });
        if (res.ok) {
          refresh();
        }
      } finally {
        setReleasing(null);
      }
    },
    [refresh]
  );

  const handleCleanup = useCallback(async () => {
    setCleaningUp(true);
    try {
      const res = await fetch("/api/locks/cleanup", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        refresh();
        if (data.released === 0) {
          // No expired locks to clean
        }
      }
    } finally {
      setCleaningUp(false);
    }
  }, [refresh]);

  const activeLocks = locks.filter((l) => getLockStatus(l) === "active");
  const expiredLocks = locks.filter((l) => getLockStatus(l) === "expired");

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
            </span>
            <span className="text-muted">{activeLocks.length} active</span>
          </div>
          {expiredLocks.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-2 w-2 rounded-full bg-yellow" />
              <span className="text-muted">{expiredLocks.length} expired</span>
            </div>
          )}
          <span className="text-muted">{locks.length} total</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">Polling every 5s</span>
          {expiredLocks.length > 0 && (
            <button
              onClick={handleCleanup}
              disabled={cleaningUp}
              className="flex items-center gap-1.5 rounded-md border border-yellow/30 bg-yellow/10 px-3 py-1.5 text-xs font-medium text-yellow hover:bg-yellow/20 transition-colors disabled:opacity-50"
            >
              {cleaningUp ? "Cleaning..." : `Cleanup Expired (${expiredLocks.length})`}
            </button>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">Active Resources</h2>
        <RepoConflictMap locks={locks} recentlyUpdated={recentlyUpdated} />
      </div>
      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">All Locks</h2>
        <LocksTable locks={locks} recentlyUpdated={recentlyUpdated} onRelease={handleRelease} />
      </div>
    </div>
  );
}
