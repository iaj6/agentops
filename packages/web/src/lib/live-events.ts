import type { AgentEvent } from "@agentops/core";

/**
 * State shared by the Events page list and its "N total" counter.
 * Kept in one object so a live SSE event updates both atomically via a
 * single pure reducer — the previous split-state version bumped the
 * total on every SSE delivery even when the event was a duplicate,
 * inflating the counter forever while connected.
 */
export interface LiveEventState {
  readonly events: AgentEvent[];
  readonly total: number;
}

/**
 * Pure reducer: prepend a live event unless it is already present.
 * The total only increments when the event was actually inserted.
 */
export function applyLiveEvent(
  state: LiveEventState,
  event: AgentEvent,
): LiveEventState {
  const id = event.id as string;
  if (state.events.some((e) => (e.id as string) === id)) {
    return state;
  }
  return { events: [event, ...state.events], total: state.total + 1 };
}
