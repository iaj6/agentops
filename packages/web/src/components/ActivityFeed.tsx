"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { EventCategoryBadge } from "./EventCategoryBadge";
import { TimeAgo } from "./TimeAgo";

interface FeedEvent {
  id: string;
  category: string;
  type: string;
  sourceId: string;
  timestamp: string;
}

function sourceLink(category: string, sourceId: string): string {
  switch (category) {
    case "job":
      return `/jobs/${sourceId}`;
    case "run":
      return `/runs/${sourceId}`;
    case "session":
      return `/sessions/${sourceId}`;
    default:
      return `/events`;
  }
}

function formatEventType(type: string): string {
  // "job.queued" -> "Job Queued"
  return type
    .split(".")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function ActivityFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/events/recent?limit=15");
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 10_000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  if (loading && events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Live Activity
        </h3>
        <p className="py-8 text-center text-sm text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
          Live Activity
        </h3>
        <Link
          href="/events"
          className="text-xs text-accent hover:underline"
        >
          View all
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No recent events</p>
      ) : (
        <div className="space-y-1">
          {events.map((event) => (
            <Link
              key={event.id}
              href={sourceLink(event.category, event.sourceId)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
            >
              <EventCategoryBadge category={event.category} />
              <span className="flex-1 truncate text-foreground text-xs">
                {formatEventType(event.type)}
              </span>
              <span className="shrink-0 text-xs text-muted">
                <TimeAgo date={event.timestamp} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
