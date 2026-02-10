"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Session } from "@agentops/core";

interface UseSessionsReturn {
  sessions: Session[];
  loading: boolean;
  /** Set of session IDs that were recently updated (for highlight animation) */
  recentlyUpdated: Set<string>;
}

export function useSessions(initialSessions: Session[]): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
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
    async function fetchSessions() {
      setLoading(true);
      try {
        const res = await fetch("/api/sessions?limit=50");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSessions(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSessions();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll for updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/sessions?limit=50");
        if (res.ok) {
          const data = await res.json();
          setSessions((prev) => {
            for (const session of data as Session[]) {
              const sessionId = session.id as string;
              const existing = prev.find(
                (s) => (s.id as string) === sessionId,
              );
              if (!existing || existing.updatedAt !== session.updatedAt) {
                markUpdated(sessionId);
              }
            }
            return data;
          });
        }
      } catch {
        // Ignore fetch errors during polling
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const markUpdated = useCallback((sessionId: string) => {
    setRecentlyUpdated((prev) => new Set(prev).add(sessionId));

    const existing = timeoutsRef.current.get(sessionId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      setRecentlyUpdated((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      timeoutsRef.current.delete(sessionId);
    }, 3000);
    timeoutsRef.current.set(sessionId, timeout);
  }, []);

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

  return { sessions, loading, recentlyUpdated };
}
