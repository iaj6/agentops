"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ResourceLock } from "@agentops/core";

const POLL_INTERVAL_MS = 5000;

interface UseLocksReturn {
  locks: ResourceLock[];
  loading: boolean;
  recentlyUpdated: Set<string>;
  refresh: () => void;
}

export function useLocks(initialLocks: ResourceLock[]): UseLocksReturn {
  const [locks, setLocks] = useState<ResourceLock[]>(initialLocks);
  const [loading, setLoading] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set());
  const prevLocksRef = useRef<Map<string, ResourceLock>>(new Map());

  // Build initial prev map
  useEffect(() => {
    const map = new Map<string, ResourceLock>();
    for (const lock of initialLocks) {
      map.set(lock.id as string, lock);
    }
    prevLocksRef.current = map;
  }, [initialLocks]);

  const fetchLocks = useCallback(async () => {
    try {
      const res = await fetch("/api/locks?limit=100");
      if (res.ok) {
        const data: ResourceLock[] = await res.json();

        // Detect changed locks
        const changed = new Set<string>();
        for (const lock of data) {
          const id = lock.id as string;
          const prev = prevLocksRef.current.get(id);
          if (!prev) {
            // New lock
            changed.add(id);
          } else if (prev.released !== lock.released) {
            // Status changed
            changed.add(id);
          }
        }

        // Update prev map
        const newMap = new Map<string, ResourceLock>();
        for (const lock of data) {
          newMap.set(lock.id as string, lock);
        }
        prevLocksRef.current = newMap;

        setLocks(data);

        if (changed.size > 0) {
          setRecentlyUpdated(changed);
          // Clear highlights after 3 seconds
          setTimeout(() => setRecentlyUpdated(new Set()), 3000);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchLocks();
  }, [fetchLocks]);

  // Polling
  useEffect(() => {
    const interval = setInterval(fetchLocks, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchLocks]);

  return { locks, loading, recentlyUpdated, refresh: fetchLocks };
}
