"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentEvent } from "@agentops/core";
import { useEventSource, type SSEEvent } from "./useEventSource";

interface UseEventsOptions {
  category?: string;
  type?: string;
  userId?: string;
  /** Cutoff ISO timestamp; events older than this are excluded server-side. */
  since?: string;
}

interface UseEventsReturn {
  events: AgentEvent[];
  loading: boolean;
  connected: boolean;
  total: number;
}

export function useEvents(options: UseEventsOptions = {}): UseEventsReturn {
  const { category, type, userId, since } = options;
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchEvents() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (type) params.set("type", type);
        if (userId) params.set("userId", userId);
        if (since) params.set("since", since);
        params.set("limit", "100");

        const res = await fetch(`/api/events/list?${params.toString()}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setEvents(data.events);
          setTotal(data.total);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchEvents();
    return () => {
      cancelled = true;
    };
  }, [category, type, userId, since]);

  const onEvent = useCallback(
    (event: SSEEvent) => {
      const agentEvent = event.data as AgentEvent;
      if (!agentEvent.id) return;

      // Apply client-side filters
      if (category && agentEvent.category !== category) return;
      if (type && agentEvent.type !== type) return;

      setEvents((prev) => {
        // Prepend new event if not already present
        if (prev.some((e) => (e.id as string) === (agentEvent.id as string))) {
          return prev;
        }
        return [agentEvent, ...prev];
      });
      setTotal((prev) => prev + 1);
    },
    [category, type],
  );

  const { connected } = useEventSource({
    category,
    eventType: type,
    onEvent,
  });

  return { events, loading, connected, total };
}
