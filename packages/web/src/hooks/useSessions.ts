"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Session } from "@agentops/core";

interface UseSessionsReturn {
  sessions: Session[];
  loading: boolean;
  /** Set of session IDs that were recently updated (for highlight animation) */
  recentlyUpdated: Set<string>;
}

export function useSessions(
  initialSessions: Session[],
  scope?: { view?: string | null; userId?: string | null },
): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [loading, setLoading] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(
    new Set(),
  );
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Stable scope key so the fetch + polling effects re-run when the
  // user-filter changes but not on every render due to a new {} prop.
  const scopeKey = `${scope?.view ?? ""}|${scope?.userId ?? ""}`;

  function buildUrl(): string {
    const p = new URLSearchParams({ limit: "50" });
    if (scope?.view) p.set("view", scope.view);
    if (scope?.userId) p.set("userId", scope.userId);
    return `/api/sessions?${p.toString()}`;
  }

  // Fetch from the API when the page mounts or the view scope changes.
  // The SSR-delivered initialSessions reflects the URL at first render,
  // but useState ignores prop updates on navigation — so the fetch is
  // what keeps us aligned with the current scope.
  useEffect(() => {
    let cancelled = false;
    async function fetchSessions() {
      setLoading(true);
      try {
        const res = await fetch(buildUrl());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Poll for updates every 5 seconds, also scope-aware.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(buildUrl());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

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
