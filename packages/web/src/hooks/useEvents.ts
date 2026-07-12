"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentEvent } from "@agentops/core";
import { applyLiveEvent, type LiveEventState } from "@/lib/live-events";
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
  // Events list + total live in one state object so the SSE handler can
  // update both through the pure applyLiveEvent reducer — the total must
  // only grow when an event is genuinely new, not on every delivery.
  const [live, setLive] = useState<LiveEventState>({ events: [], total: 0 });
  const [loading, setLoading] = useState(false);

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
          setLive({ events: data.events, total: data.total });
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

      // Prepend new event if not already present; the total only moves
      // when the event was genuinely inserted (applyLiveEvent returns
      // the previous state unchanged for duplicates).
      setLive((prev) => applyLiveEvent(prev, agentEvent));
    },
    [category, type],
  );

  // Forward the user scope to the SSE endpoint — without it the server
  // resolves an admin connection to the team-wide stream and the live
  // feed mixes other users' events into a user-filtered page.
  const { connected } = useEventSource({
    category,
    eventType: type,
    userId,
    onEvent,
  });

  return { events: live.events, loading, connected, total: live.total };
}
