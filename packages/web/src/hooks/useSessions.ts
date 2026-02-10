"use client";

import { useState, useCallback, useEffect } from "react";
import type { Session } from "@agentops/core";

interface UseSessionsReturn {
  sessions: Session[];
  loading: boolean;
}

export function useSessions(initialSessions: Session[]): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [loading, setLoading] = useState(false);

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

  return { sessions, loading };
}
