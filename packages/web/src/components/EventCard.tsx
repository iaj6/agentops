import type { AgentEvent } from "@agentops/core";
import { EventCategoryBadge } from "./EventCategoryBadge";

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function EventCard({ event }: { event: AgentEvent }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <EventCategoryBadge category={event.category} />
          <span className="text-sm font-medium text-foreground">{event.type}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>Source: {event.sourceId}</span>
          <span>{formatTimestamp(event.timestamp)}</span>
        </div>
        {Object.keys(event.payload).length > 0 && (
          <pre className="mt-2 rounded bg-muted/10 p-2 text-xs text-muted overflow-x-auto">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        )}
      </div>
      <span className="text-xs text-muted shrink-0">{(event.id as string).slice(0, 12)}</span>
    </div>
  );
}
