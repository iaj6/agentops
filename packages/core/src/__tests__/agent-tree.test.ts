import { describe, it, expect } from "vitest";
import { buildAgentTimeline } from "../agent-tree.js";
import type { AgentEvent } from "../types.js";
import { EventCategory, createEventId } from "../types.js";

let idCounter = 0;
function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  idCounter++;
  return {
    id: createEventId(`evt_test_${idCounter}`),
    category: EventCategory.Action,
    type: "action.taken",
    payload: {},
    sourceId: "session_1",
    timestamp: "2025-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeAgentSpawnedEvent(
  agentId: string,
  agentType: string,
  timestamp: string,
  parentAgentId?: string,
): AgentEvent {
  return makeEvent({
    type: "agent.spawned",
    timestamp,
    payload: {
      agentId,
      agentType,
      sessionId: "session_1",
      ...(parentAgentId !== undefined ? { parentAgentId } : {}),
    },
  });
}

function makeAgentCompletedEvent(
  agentId: string,
  timestamp: string,
): AgentEvent {
  return makeEvent({
    type: "agent.completed",
    timestamp,
    payload: { agentId },
  });
}

function makeTaskSpawnEvent(
  parentAgentId: string,
  childAgentId: string,
  subagentType: string,
  timestamp: string,
): AgentEvent {
  return makeEvent({
    type: "action.taken",
    category: EventCategory.Action,
    sourceId: parentAgentId,
    timestamp,
    payload: {
      toolName: "Task",
      agentId: parentAgentId,
      subagentId: childAgentId,
      subagent_type: subagentType,
    },
  });
}

function makeSendMessageEvent(
  from: string,
  to: string,
  summary: string,
  timestamp: string,
): AgentEvent {
  return makeEvent({
    type: "action.taken",
    category: EventCategory.Action,
    timestamp,
    payload: {
      toolName: "SendMessage",
      from,
      to,
      summary,
    },
  });
}

function makeActionEvent(
  agentId: string,
  timestamp: string,
  extras: Record<string, unknown> = {},
): AgentEvent {
  return makeEvent({
    type: "action.taken",
    category: EventCategory.Action,
    sourceId: agentId,
    timestamp,
    payload: {
      agentId,
      toolName: "Read",
      ...extras,
    },
  });
}

describe("buildAgentTimeline", () => {
  it("returns null for empty events array", () => {
    const result = buildAgentTimeline([]);
    expect(result).toBeNull();
  });

  it("returns null when no agent.spawned events exist", () => {
    const events: AgentEvent[] = [
      makeEvent({
        type: "action.taken",
        payload: { toolName: "Read" },
      }),
      makeEvent({
        type: "run.started",
        category: EventCategory.Run,
      }),
    ];

    const result = buildAgentTimeline(events);
    expect(result).toBeNull();
  });

  it("builds timeline for a single sub-agent spawn/complete cycle", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.totalAgents).toBe(1);
    expect(result!.agents).toHaveLength(1);
    expect(result!.agents[0].agentId).toBe("agent-lead");
    expect(result!.agents[0].agentType).toBe("Lead");
    expect(result!.agents[0].completedAt).toBe("2025-07-01T10:05:00.000Z");
    expect(result!.agents[0].parentAgentId).toBeNull();
    expect(result!.rootAgent.agentId).toBe("agent-lead");
  });

  it("builds timeline with multiple parallel agents", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentSpawnedEvent("agent-explore", "Explore", "2025-07-01T10:01:00.000Z", "agent-lead"),
      makeAgentSpawnedEvent("agent-impl", "Implementer", "2025-07-01T10:01:30.000Z", "agent-lead"),
      makeAgentCompletedEvent("agent-explore", "2025-07-01T10:03:00.000Z"),
      makeAgentCompletedEvent("agent-impl", "2025-07-01T10:04:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.totalAgents).toBe(3);
    expect(result!.agents).toHaveLength(3);

    const lead = result!.agents.find((a) => a.agentId === "agent-lead");
    expect(lead).toBeDefined();
    expect(lead!.parentAgentId).toBeNull();

    const explore = result!.agents.find((a) => a.agentId === "agent-explore");
    expect(explore).toBeDefined();
    expect(explore!.agentType).toBe("Explore");
    expect(explore!.parentAgentId).toBe("agent-lead");

    const impl = result!.agents.find((a) => a.agentId === "agent-impl");
    expect(impl).toBeDefined();
    expect(impl!.agentType).toBe("Implementer");
    expect(impl!.parentAgentId).toBe("agent-lead");
  });

  it("extracts communications from SendMessage events", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentSpawnedEvent("agent-impl", "Implementer", "2025-07-01T10:01:00.000Z", "agent-lead"),
      makeSendMessageEvent("agent-lead", "agent-impl", "Start working on auth", "2025-07-01T10:02:00.000Z"),
      makeSendMessageEvent("agent-impl", "agent-lead", "Auth module complete", "2025-07-01T10:03:00.000Z"),
      makeAgentCompletedEvent("agent-impl", "2025-07-01T10:04:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.communications).toHaveLength(2);

    expect(result!.communications[0].from).toBe("agent-lead");
    expect(result!.communications[0].to).toBe("agent-impl");
    expect(result!.communications[0].summary).toBe("Start working on auth");
    expect(result!.communications[0].timestamp).toBe("2025-07-01T10:02:00.000Z");

    expect(result!.communications[1].from).toBe("agent-impl");
    expect(result!.communications[1].to).toBe("agent-lead");
    expect(result!.communications[1].summary).toBe("Auth module complete");
  });

  it("infers parent-child from Task tool events", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeTaskSpawnEvent("agent-lead", "agent-sub", "Explore", "2025-07-01T10:01:00.000Z"),
      makeAgentSpawnedEvent("agent-sub", "Explore", "2025-07-01T10:01:01.000Z"),
      makeAgentCompletedEvent("agent-sub", "2025-07-01T10:03:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:04:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();

    const sub = result!.agents.find((a) => a.agentId === "agent-sub");
    expect(sub).toBeDefined();
    expect(sub!.parentAgentId).toBe("agent-lead");
  });

  it("calculates timeline timespan correctly", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T09:00:00.000Z"),
      makeAgentSpawnedEvent("agent-sub", "Explore", "2025-07-01T09:30:00.000Z", "agent-lead"),
      makeAgentCompletedEvent("agent-sub", "2025-07-01T10:00:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:30:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.timespan.startedAt).toBe("2025-07-01T09:00:00.000Z");
    expect(result!.timespan.completedAt).toBe("2025-07-01T10:30:00.000Z");
  });

  it("counts tool calls per agent correctly", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentSpawnedEvent("agent-impl", "Implementer", "2025-07-01T10:01:00.000Z", "agent-lead"),
      makeActionEvent("agent-lead", "2025-07-01T10:02:00.000Z"),
      makeActionEvent("agent-lead", "2025-07-01T10:02:01.000Z"),
      makeActionEvent("agent-impl", "2025-07-01T10:02:02.000Z"),
      makeActionEvent("agent-impl", "2025-07-01T10:02:03.000Z"),
      makeActionEvent("agent-impl", "2025-07-01T10:02:04.000Z"),
      makeAgentCompletedEvent("agent-impl", "2025-07-01T10:03:00.000Z"),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:04:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();

    const lead = result!.agents.find((a) => a.agentId === "agent-lead");
    expect(lead!.toolCalls).toBe(2);

    const impl = result!.agents.find((a) => a.agentId === "agent-impl");
    expect(impl!.toolCalls).toBe(3);

    expect(result!.totalToolCalls).toBe(5);
  });

  it("tracks files changed and commands per agent", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeActionEvent("agent-lead", "2025-07-01T10:01:00.000Z", {
        filePath: "src/auth.ts",
      }),
      makeActionEvent("agent-lead", "2025-07-01T10:01:01.000Z", {
        filePath: "src/login.ts",
      }),
      makeActionEvent("agent-lead", "2025-07-01T10:01:02.000Z", {
        command: "npm test",
      }),
      makeActionEvent("agent-lead", "2025-07-01T10:01:03.000Z", {
        filePath: "src/auth.ts", // duplicate file
      }),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();

    const lead = result!.rootAgent;
    // src/auth.ts appears twice but should be deduplicated in filesChanged
    expect(lead.filesChanged).toContain("src/auth.ts");
    expect(lead.filesChanged).toContain("src/login.ts");
    expect(lead.filesChanged).toHaveLength(2);
    expect(lead.commands).toEqual(["npm test"]);
  });

  it("handles agents with no completedAt (still running)", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentSpawnedEvent("agent-sub", "Explore", "2025-07-01T10:01:00.000Z", "agent-lead"),
      // no agent.completed events
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.agents[0].completedAt).toBeNull();
    expect(result!.agents[1].completedAt).toBeNull();
  });

  it("sorts events by timestamp regardless of input order", () => {
    const events: AgentEvent[] = [
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeAgentSpawnedEvent("agent-sub", "Explore", "2025-07-01T10:01:00.000Z", "agent-lead"),
      makeAgentCompletedEvent("agent-sub", "2025-07-01T10:03:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    // Timespan should reflect chronological order
    expect(result!.timespan.startedAt).toBe("2025-07-01T10:00:00.000Z");
    expect(result!.timespan.completedAt).toBe("2025-07-01T10:05:00.000Z");
    // Lead should be first spawned and be root
    expect(result!.rootAgent.agentId).toBe("agent-lead");
  });

  it("uses recipient field for SendMessage when to is not present", () => {
    const events: AgentEvent[] = [
      makeAgentSpawnedEvent("agent-lead", "Lead", "2025-07-01T10:00:00.000Z"),
      makeEvent({
        type: "action.taken",
        category: EventCategory.Action,
        timestamp: "2025-07-01T10:02:00.000Z",
        payload: {
          toolName: "SendMessage",
          from: "agent-lead",
          recipient: "agent-impl",
          content: "Hello there",
        },
      }),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.communications).toHaveLength(1);
    expect(result!.communications[0].to).toBe("agent-impl");
    expect(result!.communications[0].summary).toBe("Hello there");
  });

  it("extracts sessionId from event payload when available", () => {
    const events: AgentEvent[] = [
      makeEvent({
        type: "agent.spawned",
        timestamp: "2025-07-01T10:00:00.000Z",
        payload: {
          agentId: "agent-lead",
          agentType: "Lead",
          sessionId: "session_custom_123",
        },
      }),
      makeAgentCompletedEvent("agent-lead", "2025-07-01T10:05:00.000Z"),
    ];

    const result = buildAgentTimeline(events);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("session_custom_123");
  });
});
