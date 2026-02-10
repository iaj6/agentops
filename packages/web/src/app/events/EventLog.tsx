"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentEvent } from "@agentops/core";
import { EventCategory } from "@agentops/core";
import { EventCard } from "@/components/EventCard";
import { useEvents } from "@/hooks/useEvents";

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "Job", value: EventCategory.Job },
  { label: "Run", value: EventCategory.Run },
  { label: "Session", value: EventCategory.Session },
  { label: "Policy", value: EventCategory.Policy },
  { label: "Cost", value: EventCategory.Cost },
  { label: "Action", value: EventCategory.Action },
];

const TIME_RANGES = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "All", ms: 0 },
];

const MAX_DISPLAY = 200;

export function EventLog({ initialEvents }: { initialEvents: AgentEvent[] }) {
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [timeRange, setTimeRange] = useState(0); // 0 = all
  const [paused, setPaused] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(MAX_DISPLAY);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const { events, loading, connected, total } = useEvents({
    category: category || undefined,
    type: typeFilter || undefined,
  });

  const displayEvents = events.length > 0 ? events : initialEvents;

  // Apply all filters
  const filteredEvents = displayEvents.filter((e) => {
    if (category && e.category !== category) return false;
    if (typeFilter && !e.type.toLowerCase().includes(typeFilter.toLowerCase())) return false;
    if (sourceFilter && !e.sourceId.toLowerCase().includes(sourceFilter.toLowerCase())) return false;
    if (timeRange > 0) {
      const cutoff = Date.now() - timeRange;
      if (new Date(e.timestamp).getTime() < cutoff) return false;
    }
    return true;
  });

  // Pause buffering: only show events up to when pause was toggled
  const [pausedEvents, setPausedEvents] = useState<AgentEvent[]>([]);
  const [pausedCount, setPausedCount] = useState(0);

  useEffect(() => {
    if (paused) {
      // Snapshot current events when pausing
      setPausedEvents(filteredEvents);
      setPausedCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // Track new events while paused
  useEffect(() => {
    if (paused) {
      const diff = filteredEvents.length - pausedEvents.length;
      if (diff > 0) setPausedCount(diff);
    }
  }, [paused, filteredEvents.length, pausedEvents.length]);

  const shownEvents = paused ? pausedEvents : filteredEvents;
  const limitedEvents = shownEvents.slice(0, displayLimit);
  const hasMore = shownEvents.length > displayLimit;

  // Auto-scroll to top on new events
  const prevCountRef = useRef(limitedEvents.length);
  useEffect(() => {
    if (!paused && autoScroll && limitedEvents.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevCountRef.current = limitedEvents.length;
  }, [limitedEvents.length, paused, autoScroll]);

  const handleLoadMore = useCallback(() => {
    setDisplayLimit((prev) => prev + MAX_DISPLAY);
  }, []);

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Category filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Category:</span>
          <div className="flex gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  category === cat.value
                    ? "bg-foreground text-background"
                    : "bg-muted/15 text-muted hover:bg-muted/25"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time range filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Range:</span>
          <div className="flex gap-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range.label}
                onClick={() => setTimeRange(range.ms)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  timeRange === range.ms
                    ? "bg-foreground text-background"
                    : "bg-muted/15 text-muted hover:bg-muted/25"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search inputs and status row */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by type..."
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <input
          type="text"
          placeholder="Filter by source ID..."
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />

        {/* Pause/resume button */}
        <button
          onClick={() => setPaused(!paused)}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            paused
              ? "border-yellow/30 bg-yellow/15 text-yellow hover:bg-yellow/25"
              : "border-border bg-card text-muted hover:bg-surface-2"
          }`}
        >
          {paused ? (
            <>
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Resume{pausedCount > 0 && ` (${pausedCount} new)`}
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Pause
            </>
          )}
        </button>

        {/* Status area */}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {connected && !paused && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  connected ? (paused ? "bg-yellow" : "bg-green") : "bg-red"
                }`}
              />
            </span>
            {connected ? (paused ? "Paused" : "Live") : "Disconnected"}
          </div>
          <span>
            {filteredEvents.length} shown / {total} total
          </span>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted">Loading events...</p>
      )}

      {/* Event list */}
      <div ref={scrollRef} className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto">
        {limitedEvents.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-16">
            <p className="text-sm font-medium text-foreground">No events found</p>
            <p className="text-xs text-muted mt-1">Events will stream here in real-time.</p>
          </div>
        ) : (
          <>
            {limitedEvents.map((event) => (
              <EventCard key={event.id as string} event={event} />
            ))}
            {hasMore && (
              <button
                onClick={handleLoadMore}
                className="w-full rounded-lg border border-border bg-surface py-3 text-sm text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                Load more ({shownEvents.length - displayLimit} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
