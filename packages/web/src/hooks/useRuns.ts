"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Run } from "@agentops/core";
import { useEventSource, type SSEEvent } from "./useEventSource";

interface UseRunsReturn {
  runs: Run[];
  loading: boolean;
  connected: boolean;
  /** Set of run IDs that were recently updated (for highlight animation) */
  recentlyUpdated: Set<string>;
}

export function useRuns(initialRuns: Run[]): UseRunsReturn {
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [loading, setLoading] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(
    new Set(),
  );
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Fetch initial data from API
  useEffect(() => {
    let cancelled = false;
    async function fetchRuns() {
      setLoading(true);
      try {
        const res = await fetch("/api/runs?limit=50");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setRuns(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  const markUpdated = useCallback((runId: string) => {
    setRecentlyUpdated((prev) => new Set(prev).add(runId));

    // Clear any existing timeout for this run
    const existing = timeoutsRef.current.get(runId);
    if (existing) clearTimeout(existing);

    // Remove highlight after 3 seconds
    const timeout = setTimeout(() => {
      setRecentlyUpdated((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
      timeoutsRef.current.delete(runId);
    }, 3000);
    timeoutsRef.current.set(runId, timeout);
  }, []);

  const onEvent = useCallback(
    (event: SSEEvent) => {
      const run = event.data;
      const runId = run.id as string;

      setRuns((prev) => {
        if (event.type === "run_created") {
          // Prepend new run if not already present
          if (prev.some((r) => (r.id as string) === runId)) {
            return prev.map((r) => ((r.id as string) === runId ? run : r));
          }
          return [run, ...prev];
        }

        // run_updated, run_completed, run_failed: update in place
        const idx = prev.findIndex((r) => (r.id as string) === runId);
        if (idx === -1) {
          // Unknown run appeared, prepend it
          return [run, ...prev];
        }
        const next = [...prev];
        next[idx] = run;
        return next;
      });

      markUpdated(runId);
    },
    [markUpdated],
  );

  const { connected } = useEventSource({ onEvent });

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    };
  }, []);

  return { runs, loading, connected, recentlyUpdated };
}
