"use client";

import { useState, useEffect } from "react";
import type { ResourceLock } from "@agentops/core";

interface UseLocksReturn {
  locks: ResourceLock[];
  loading: boolean;
}

export function useLocks(initialLocks: ResourceLock[]): UseLocksReturn {
  const [locks, setLocks] = useState<ResourceLock[]>(initialLocks);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchLocks() {
      setLoading(true);
      try {
        const res = await fetch("/api/locks?limit=100");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setLocks(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLocks();
    return () => {
      cancelled = true;
    };
  }, []);

  return { locks, loading };
}
