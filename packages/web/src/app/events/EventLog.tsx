"use client";

import { useState } from "react";
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

export function EventLog({ initialEvents }: { initialEvents: AgentEvent[] }) {
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const { events, loading, connected, total } = useEvents({
    category: category || undefined,
    type: typeFilter || undefined,
  });

  const displayEvents = events.length > 0 ? events : initialEvents;

  const filteredEvents = displayEvents.filter((e) => {
    if (category && e.category !== category) return false;
    if (typeFilter && !e.type.includes(typeFilter)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
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

        <input
          type="text"
          placeholder="Filter by type..."
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground placeholder:text-muted"
        />

        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span
            className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green" : "bg-red"}`}
          />
          {connected ? "Live" : "Disconnected"}
          <span className="ml-2">{total} total</span>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted">Loading events...</p>
      )}

      <div className="space-y-2">
        {filteredEvents.length === 0 && !loading ? (
          <p className="text-sm text-muted py-8 text-center">No events found</p>
        ) : (
          filteredEvents.map((event) => (
            <EventCard key={event.id as string} event={event} />
          ))
        )}
      </div>
    </div>
  );
}
