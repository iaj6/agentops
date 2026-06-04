"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Run, AgentEvent } from "@agentops/core";

export type SSEEventType =
  | "connected"
  | "run_created"
  | "run_updated"
  | "run_completed"
  | "run_failed"
  | "job.queued"
  | "job.dispatched"
  | "job.completed"
  | "job.failed"
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
  "job.queued",
  "job.dispatched",
  "job.completed",
  "job.failed",
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
  const { runId, category, eventType, onEvent } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const retriesRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const params = new URLSearchParams();
    if (runId) params.set("runId", runId);
    if (category) params.set("category", category);
    if (eventType) params.set("type", eventType);

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
        // eslint-disable-next-line react-hooks/immutability
        setTimeout(connect, delay);
      }
    };
  }, [runId, category, eventType]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);

  return { connected, lastEvent };
}
