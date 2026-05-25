import type { AgentEvent, EventId } from "./types.js";
import { EventCategory, createEventId } from "./types.js";

// ─── Event type constants ────────────────────────────────────────────────────

export const EVENT_TYPES = {
  // Job events
  "job.queued": "job.queued",
  "job.dispatched": "job.dispatched",
  "job.completed": "job.completed",
  "job.failed": "job.failed",

  // Run events
  "run.started": "run.started",
  "run.completed": "run.completed",
  "run.failed": "run.failed",

  // Action events
  "action.taken": "action.taken",

  // Policy events
  "policy.violated": "policy.violated",

  // Cost events
  "cost.threshold": "cost.threshold",

  // Budget events (per-user spend caps). Emitted once per period when a
  // user's period spend crosses the warn threshold (warning) or the
  // budget itself (breached). Dedupe is enforced by the budgets table
  // last_warn_at / last_breach_at columns, not by the event sink.
  "budget.warning": "budget.warning",
  "budget.breached": "budget.breached",

  // Session events
  "session.started": "session.started",
  "session.terminated": "session.terminated",

  // Agent events
  "agent.spawned": "agent.spawned",
  "agent.completed": "agent.completed",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ─── Event factory ───────────────────────────────────────────────────────────

let counter = 0;
function generateId(): string {
  counter++;
  return `evt_${Date.now()}_${counter}`;
}

export function createEvent(
  category: EventCategory,
  type: string,
  sourceId: string,
  payload: Record<string, unknown> = {},
): AgentEvent {
  return {
    id: createEventId(generateId()),
    category,
    type,
    payload,
    sourceId,
    timestamp: new Date().toISOString(),
  };
}

// ─── Event bus ───────────────────────────────────────────────────────────────

interface Subscription {
  readonly id: string;
  readonly type: string;
  readonly handler: (event: AgentEvent) => void;
}

let subCounter = 0;
function generateSubId(): string {
  subCounter++;
  return `sub_${Date.now()}_${subCounter}`;
}

export class EventBus {
  private subscriptions: Subscription[] = [];

  subscribe(type: string, handler: (event: AgentEvent) => void): string {
    const id = generateSubId();
    this.subscriptions.push({ id, type, handler });
    return id;
  }

  unsubscribe(id: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
  }

  publish(event: AgentEvent): void {
    for (const sub of this.subscriptions) {
      if (sub.type === "*" || sub.type === event.type) {
        sub.handler(event);
      }
    }
  }
}
