"use client";

import { useState, useCallback, useEffect } from "react";
import type { Run, SessionSummary } from "@agentops/core";
import { useEventSource, type SSEEvent } from "./useEventSource";

interface UseRunDetailReturn {
  run: Run | null;
  summary: SessionSummary | null;
  loading: boolean;
  connected: boolean;
}

export function useRunDetail(
  runId: string,
  initialRun: Run,
  initialSummary: SessionSummary | null,
): UseRunDetailReturn {
  const [run, setRun] = useState<Run | null>(initialRun);
  const [summary, setSummary] = useState<SessionSummary | null>(initialSummary);
  const [loading, setLoading] = useState(false);

  // Fetch initial data
  useEffect(() => {
    let cancelled = false;
    async function fetchRun() {
      setLoading(true);
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setRun(data.run);
          setSummary(data.summary ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRun();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const onEvent = useCallback((event: SSEEvent) => {
    if ("status" in event.data && "goal" in event.data) {
      setRun(event.data as Run);
    }
  }, []);

  const { connected } = useEventSource({ runId, onEvent });

  return { run, summary, loading, connected };
}
