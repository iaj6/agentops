import type { AgentEvent } from "@agentops/core";

/**
 * Cursor for polling the events table without duplicates or gaps.
 *
 * `listEvents({ since })` is deliberately inclusive (gte): two events can
 * share a timestamp, and an exclusive (gt) cursor would silently drop the
 * second event if the first had already been emitted when the boundary
 * advanced. The price of gte is that already-emitted events sitting exactly
 * on the boundary timestamp re-match on every subsequent poll — this cursor
 * tracks their IDs so each event is emitted exactly once.
 */
export interface EventPollCursor {
  /** Boundary timestamp to pass as `since` (inclusive). */
  readonly since: string;
  /** IDs of events already emitted whose timestamp equals `since`. */
  readonly seenIdsAtBoundary: ReadonlySet<string>;
}

export function createEventPollCursor(since: string): EventPollCursor {
  return { since, seenIdsAtBoundary: new Set() };
}

/**
 * Advance a cursor over one batch returned by
 * `listEvents({ since: cursor.since, ... })`.
 *
 * `batch` is expected newest-first (listEvents' order). `fresh` contains
 * only events not yet emitted, oldest-first — ready for chronological
 * emission. `next` is the cursor to use for the following poll.
 */
export function advanceEventPollCursor(
  cursor: EventPollCursor,
  batch: ReadonlyArray<AgentEvent>,
): { fresh: AgentEvent[]; next: EventPollCursor } {
  const fresh = [...batch]
    .reverse()
    .filter(
      (e) =>
        !(
          e.timestamp === cursor.since &&
          cursor.seenIdsAtBoundary.has(e.id as string)
        ),
    );

  if (fresh.length === 0) {
    return { fresh, next: cursor };
  }

  // New boundary = newest timestamp emitted. All batch events satisfy
  // timestamp >= cursor.since and only boundary-timestamp events were
  // filtered out, so the newest fresh event carries the batch maximum.
  const nextSince = fresh[fresh.length - 1]!.timestamp;

  // Seed with the previous boundary's seen IDs when the boundary did not
  // move — those events would still re-match a gte query at nextSince.
  const seenIdsAtBoundary = new Set<string>(
    nextSince === cursor.since ? cursor.seenIdsAtBoundary : [],
  );
  for (const e of fresh) {
    if (e.timestamp === nextSince) {
      seenIdsAtBoundary.add(e.id as string);
    }
  }

  return { fresh, next: { since: nextSince, seenIdsAtBoundary } };
}
