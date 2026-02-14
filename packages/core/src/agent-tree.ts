import type { AgentEvent } from "./types.js";
import { EventCategory } from "./types.js";

// ─── Agent hierarchy types ──────────────────────────────────────────────────

export interface AgentNode {
  readonly agentId: string;
  readonly agentType: string;
  readonly parentAgentId: string | null;
  readonly spawnedAt: string;
  readonly completedAt: string | null;
  readonly toolCalls: number;
  readonly filesChanged: string[];
  readonly commands: string[];
}

export interface AgentCommunication {
  readonly from: string;
  readonly to: string;
  readonly summary: string;
  readonly timestamp: string;
}

export interface AgentTimeline {
  readonly sessionId: string;
  readonly rootAgent: AgentNode;
  readonly agents: ReadonlyArray<AgentNode>;
  readonly communications: ReadonlyArray<AgentCommunication>;
  readonly totalAgents: number;
  readonly totalToolCalls: number;
  readonly timespan: { readonly startedAt: string; readonly completedAt: string };
}

// ─── Timeline reconstruction ────────────────────────────────────────────────

/**
 * Builds an AgentTimeline from a list of events.
 * Returns null if no agent events are found (single-agent session).
 */
export function buildAgentTimeline(events: AgentEvent[]): AgentTimeline | null {
  if (events.length === 0) return null;

  // Sort events by timestamp for consistent processing
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Collect agent.spawned events to build agent nodes
  const spawnedEvents = sorted.filter((e) => e.type === "agent.spawned");
  if (spawnedEvents.length === 0) return null;

  // Collect agent.completed events for completedAt
  const completedEvents = sorted.filter((e) => e.type === "agent.completed");
  const completedMap = new Map<string, string>();
  for (const evt of completedEvents) {
    const agentId = (evt.payload.agentId as string) ?? evt.sourceId;
    completedMap.set(agentId, evt.timestamp);
  }

  // Infer parent-child relationships from action.taken with toolName === "Task"
  const parentMap = new Map<string, string>();
  const taskSpawnEvents = sorted.filter(
    (e) =>
      e.type === "action.taken" &&
      (e.payload.toolName as string) === "Task",
  );
  for (const evt of taskSpawnEvents) {
    const childAgentId = (evt.payload.subagentId as string) ?? null;
    const parentAgentId = (evt.payload.agentId as string) ?? evt.sourceId;
    if (childAgentId) {
      parentMap.set(childAgentId, parentAgentId);
    }
  }

  // Count tool calls per agent from action.taken events
  const toolCallCounts = new Map<string, number>();
  const filesChangedMap = new Map<string, Set<string>>();
  const commandsMap = new Map<string, string[]>();

  const actionEvents = sorted.filter(
    (e) => e.type === "action.taken" && e.category === EventCategory.Action,
  );
  for (const evt of actionEvents) {
    const agentId = (evt.payload.agentId as string) ?? evt.sourceId;
    toolCallCounts.set(agentId, (toolCallCounts.get(agentId) ?? 0) + 1);

    // Track files changed
    const filePath = evt.payload.filePath as string | undefined;
    if (filePath) {
      if (!filesChangedMap.has(agentId)) {
        filesChangedMap.set(agentId, new Set());
      }
      filesChangedMap.get(agentId)!.add(filePath);
    }

    // Track commands
    const command = evt.payload.command as string | undefined;
    if (command) {
      if (!commandsMap.has(agentId)) {
        commandsMap.set(agentId, []);
      }
      commandsMap.get(agentId)!.push(command);
    }
  }

  // Build agent nodes from spawned events
  const agents: AgentNode[] = spawnedEvents.map((evt) => {
    const agentId = (evt.payload.agentId as string) ?? evt.sourceId;
    const agentType = (evt.payload.agentType as string) ??
      (evt.payload.subagent_type as string) ??
      "unknown";
    const parentAgentId = parentMap.get(agentId) ??
      (evt.payload.parentAgentId as string | undefined) ??
      null;

    return {
      agentId,
      agentType,
      parentAgentId,
      spawnedAt: evt.timestamp,
      completedAt: completedMap.get(agentId) ?? null,
      toolCalls: toolCallCounts.get(agentId) ?? 0,
      filesChanged: [...(filesChangedMap.get(agentId) ?? [])],
      commands: [...(commandsMap.get(agentId) ?? [])],
    };
  });

  // Determine the root agent: the one with no parent, or the first spawned
  const rootAgent = agents.find((a) => a.parentAgentId === null) ?? agents[0];

  // Extract communications from action.taken with toolName === "SendMessage"
  const sendMessageEvents = sorted.filter(
    (e) =>
      e.type === "action.taken" &&
      (e.payload.toolName as string) === "SendMessage",
  );
  const communications: AgentCommunication[] = sendMessageEvents.map((evt) => ({
    from: (evt.payload.from as string) ?? (evt.payload.agentId as string) ?? evt.sourceId,
    to: (evt.payload.to as string) ?? (evt.payload.recipient as string) ?? "unknown",
    summary: (evt.payload.summary as string) ?? (evt.payload.content as string) ?? "",
    timestamp: evt.timestamp,
  }));

  // Determine session ID from the first event's sourceId or payload
  const firstEvent = sorted[0]!;
  const lastEvent = sorted[sorted.length - 1]!;
  const sessionId = (firstEvent.payload.sessionId as string) ?? firstEvent.sourceId;

  // Calculate timespan
  const totalToolCalls = agents.reduce((sum, a) => sum + a.toolCalls, 0);
  const startedAt = firstEvent.timestamp;
  const completedAt = lastEvent.timestamp;

  return {
    sessionId,
    rootAgent: rootAgent!,
    agents,
    communications,
    totalAgents: agents.length,
    totalToolCalls,
    timespan: { startedAt, completedAt },
  };
}
