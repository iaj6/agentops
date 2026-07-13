"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Run, AgentEvent } from "@agentops/core";

export type SSEEventType =
  | "connected"
  | "run_created"
  | "run_updated"
  | "run_completed"
  | "run_failed"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "action.taken"
  | "policy.violated"
  | "cost.threshold"
  | "session.started"
  | "session.terminated";

export interface SSEEvent {
  type: SSEEventType;
  data: Run | AgentEvent;
  timestamp: number;
}

interface UseEventSourceOptions {
  /** Optional runId to filter events to a single run */
  runId?: string;
  /** Optional category filter for persisted events */
  category?: string;
  /** Optional type filter for persisted events */
  eventType?: string;
  /**
   * View scope forwarded to the SSE endpoint (e.g. "mine"). Without it
   * the server resolves the connection's default scope, which for an
   * admin is the whole team — not what a scoped page is showing.
   */
  view?: string;
  /** User scope forwarded to the SSE endpoint (admin drill-down). */
  userId?: string;
  /** Callback for each event received */
  onEvent?: (event: SSEEvent) => void;
}

interface UseEventSourceReturn {
  connected: boolean;
  lastEvent: SSEEvent | null;
}

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const ALL_EVENT_TYPES: SSEEventType[] = [
  "run_created",
  "run_updated",
  "run_completed",
  "run_failed",
  "run.started",
  "run.completed",
  "run.failed",
  "action.taken",
  "policy.violated",
  "cost.threshold",
  "session.started",
  "session.terminated",
];

export function useEventSource(
  options: UseEventSourceOptions = {},
): UseEventSourceReturn {
  const { runId, category, eventType, view, userId, onEvent } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const retriesRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const onEventRef = useRef(onEvent);
  // Keep the latest onEvent in a ref without writing it during render
  // (react-hooks/refs). It's only read inside async SSE handlers that fire
  // after this effect runs, so the one-tick deferral is safe.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    // Cancel any pending reconnect so a filter-change reconnect can't
    // race a backoff timer into opening a second stream.
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const params = new URLSearchParams();
    if (runId) params.set("runId", runId);
    if (category) params.set("category", category);
    if (eventType) params.set("type", eventType);
    if (view) params.set("view", view);
    if (userId) params.set("userId", userId);

    const qs = params.toString();
    const url = qs ? `/api/events?${qs}` : "/api/events";
    const es = new EventSource(url);
    eventSourceRef.current = es;

    function handleEvent(type: SSEEventType) {
      return (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const event: SSEEvent = { type, data, timestamp: Date.now() };
          setLastEvent(event);
          onEventRef.current?.(event);
        } catch {
          // Ignore parse errors (e.g. connected event has different shape)
        }
      };
    }

    es.addEventListener("connected", () => {
      setConnected(true);
      retriesRef.current = 0;
    });

    for (const type of ALL_EVENT_TYPES) {
      es.addEventListener(type, handleEvent(type));
    }

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Exponential backoff reconnect
      if (retriesRef.current < MAX_RETRIES) {
        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, retriesRef.current),
          MAX_DELAY_MS,
        );
        retriesRef.current += 1;
        // Self-reference is runtime-safe: this async error handler only fires
        // after `connect` is fully defined, so the reconnect closes over the
        // assigned const. (react-hooks/immutability flags the textual order.)
        // The handle is stored so unmount/filter-change cleanup can cancel
        // the pending reconnect — otherwise it would open an EventSource
        // nobody closes.
        // eslint-disable-next-line react-hooks/immutability
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [runId, category, eventType, view, userId]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);

  return { connected, lastEvent };
}
