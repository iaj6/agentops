"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Run } from "@agentops/core";

export type SSEEventType =
  | "connected"
  | "run_created"
  | "run_updated"
  | "run_completed"
  | "run_failed";

export interface SSEEvent {
  type: SSEEventType;
  data: Run;
  timestamp: number;
}

interface UseEventSourceOptions {
  /** Optional runId to filter events to a single run */
  runId?: string;
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

export function useEventSource(
  options: UseEventSourceOptions = {},
): UseEventSourceReturn {
  const { runId, onEvent } = options;
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

    const url = runId ? `/api/events?runId=${runId}` : "/api/events";
    const es = new EventSource(url);
    eventSourceRef.current = es;

    function handleEvent(type: SSEEventType) {
      return (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Run;
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

    es.addEventListener("run_created", handleEvent("run_created"));
    es.addEventListener("run_updated", handleEvent("run_updated"));
    es.addEventListener("run_completed", handleEvent("run_completed"));
    es.addEventListener("run_failed", handleEvent("run_failed"));

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
        setTimeout(connect, delay);
      }
    };
  }, [runId]);

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
