"use client";

import { useState, useEffect } from "react";
import type { AgentTimeline as AgentTimelineType } from "@agentops/core";
import { AgentCard } from "./AgentCard";

const agentTypeColors: Record<string, string> = {
  Explore: "bg-blue-500",
  "general-purpose": "bg-green-500",
  Plan: "bg-purple-500",
  Bash: "bg-orange-500",
};

const agentTypeBorderColors: Record<string, string> = {
  Explore: "border-blue-500",
  "general-purpose": "border-green-500",
  Plan: "border-purple-500",
  Bash: "border-orange-500",
};

const agentTypeTextColors: Record<string, string> = {
  Explore: "text-blue-500",
  "general-purpose": "text-green-500",
  Plan: "text-purple-500",
  Bash: "text-orange-500",
};

function getBarColor(agentType: string) {
  return agentTypeColors[agentType] ?? "bg-zinc-500";
}

function getBorderColor(agentType: string) {
  return agentTypeBorderColors[agentType] ?? "border-zinc-500";
}

function getTextColor(agentType: string) {
  return agentTypeTextColors[agentType] ?? "text-zinc-400";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

export function AgentTimelineView({ runId }: { runId: string }) {
  const [timeline, setTimeline] = useState<AgentTimelineType | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchTimeline() {
      setLoading(true);
      try {
        const res = await fetch(`/api/runs/${runId}/agents`);
        if (!res.ok) {
          setError("Failed to load agent data");
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setTimeline(data.timeline ?? null);
        }
      } catch {
        if (!cancelled) setError("Failed to load agent data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchTimeline();
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">Loading agent data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-red">{error}</p>
      </div>
    );
  }

  if (timeline === null || timeline === undefined) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">Single agent session</p>
      </div>
    );
  }

  return <AgentTimelineContent timeline={timeline} />;
}

function AgentTimelineContent({ timeline }: { timeline: AgentTimelineType }) {
  const [view, setView] = useState<"timeline" | "grid">("timeline");

  const totalMs =
    new Date(timeline.timespan.completedAt).getTime() -
    new Date(timeline.timespan.startedAt).getTime();

  // Sort agents: root first, then by spawn time
  const sortedAgents = [...timeline.agents].sort((a, b) => {
    if (a.agentId === timeline.rootAgent.agentId) return -1;
    if (b.agentId === timeline.rootAgent.agentId) return 1;
    return new Date(a.spawnedAt).getTime() - new Date(b.spawnedAt).getTime();
  });

  // Build an index for agent positions in the swimlane (for comm arrows)
  const agentIndexMap = new Map<string, number>();
  sortedAgents.forEach((a, i) => agentIndexMap.set(a.agentId, i));

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Agents</span>
          <span className="font-mono text-sm text-foreground">{timeline.totalAgents}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Tool Calls</span>
          <span className="font-mono text-sm text-foreground">{timeline.totalToolCalls}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Messages</span>
          <span className="font-mono text-sm text-foreground">{timeline.communications.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">Duration</span>
          <span className="font-mono text-sm text-foreground">{formatDuration(totalMs)}</span>
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setView("timeline")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              view === "timeline"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setView("grid")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              view === "grid"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            Grid
          </button>
        </div>
      </div>

      {view === "timeline" ? (
        <SwimlaneView
          agents={sortedAgents}
          timeline={timeline}
          totalMs={totalMs}
          agentIndexMap={agentIndexMap}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAgents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              isRoot={agent.agentId === timeline.rootAgent.agentId}
            />
          ))}
        </div>
      )}

      {/* Communications log */}
      {timeline.communications.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Communications ({timeline.communications.length})
          </h3>
          <div className="space-y-2">
            {timeline.communications.map((comm, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded bg-surface-2 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-accent whitespace-nowrap">
                  {comm.from.slice(0, 8)}
                </span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted flex-shrink-0 mt-0.5">
                  <path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-mono text-xs text-accent whitespace-nowrap">
                  {comm.to.slice(0, 8)}
                </span>
                <span className="text-xs text-foreground flex-1 min-w-0 truncate">
                  {comm.summary}
                </span>
                <span className="text-xs text-muted whitespace-nowrap">
                  {formatTime(comm.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SwimlaneView({
  agents,
  timeline,
  totalMs,
  agentIndexMap,
}: {
  agents: AgentTimelineType["agents"];
  timeline: AgentTimelineType;
  totalMs: number;
  agentIndexMap: Map<string, number>;
}) {
  const startTime = new Date(timeline.timespan.startedAt).getTime();

  // Calculate bar positions as percentages
  function getPosition(timestamp: string): number {
    if (totalMs === 0) return 0;
    const ms = new Date(timestamp).getTime() - startTime;
    return Math.max(0, Math.min(100, (ms / totalMs) * 100));
  }

  function getWidth(spawnedAt: string, completedAt: string | null): number {
    const start = getPosition(spawnedAt);
    const end = completedAt ? getPosition(completedAt) : 100;
    return Math.max(2, end - start);
  }

  const laneHeight = 48;
  const laneGap = 8;
  const totalHeight = agents.length * (laneHeight + laneGap) - laneGap;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        Agent Swimlanes
      </h3>

      {/* Time axis header */}
      <div className="mb-2 flex items-center text-xs text-muted">
        <span className="w-28 flex-shrink-0" />
        <div className="flex-1 flex justify-between px-1">
          <span className="font-mono">{formatTime(timeline.timespan.startedAt)}</span>
          <span className="font-mono">{formatTime(timeline.timespan.completedAt)}</span>
        </div>
      </div>

      {/* Swimlanes */}
      <div className="relative" style={{ minHeight: totalHeight }}>
        {agents.map((agent, i) => {
          const left = getPosition(agent.spawnedAt);
          const width = getWidth(agent.spawnedAt, agent.completedAt);
          const isRoot = agent.agentId === timeline.rootAgent.agentId;
          const top = i * (laneHeight + laneGap);

          return (
            <div
              key={agent.agentId}
              className="absolute flex items-center"
              style={{ top, height: laneHeight, left: 0, right: 0 }}
            >
              {/* Agent label */}
              <div className="w-28 flex-shrink-0 pr-2 text-right">
                <span className={`text-xs font-medium ${getTextColor(agent.agentType)}`}>
                  {agent.agentType}
                </span>
                {isRoot && (
                  <span className="ml-1 text-xs text-accent">(lead)</span>
                )}
                <p className="font-mono text-[10px] text-muted truncate">
                  {agent.agentId.slice(0, 8)}
                </p>
              </div>

              {/* Lane track */}
              <div className="flex-1 relative h-8 rounded bg-surface-2">
                {/* Bar */}
                <div
                  className={`absolute top-1 bottom-1 rounded ${getBarColor(agent.agentType)} opacity-60`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />

                {/* Tool call markers */}
                {agent.toolCalls > 0 && (() => {
                  const agentStartMs = new Date(agent.spawnedAt).getTime() - startTime;
                  const agentEndMs = agent.completedAt
                    ? new Date(agent.completedAt).getTime() - startTime
                    : totalMs;
                  const agentDuration = agentEndMs - agentStartMs;
                  const markerCount = Math.min(agent.toolCalls, 20);
                  const markers = [];
                  for (let m = 0; m < markerCount; m++) {
                    const progress = markerCount === 1 ? 0.5 : m / (markerCount - 1);
                    const markerMs = agentStartMs + progress * agentDuration;
                    const pos = totalMs === 0 ? 0 : (markerMs / totalMs) * 100;
                    markers.push(
                      <div
                        key={m}
                        className={`absolute top-2.5 h-1.5 w-1.5 rounded-full ${getBarColor(agent.agentType)}`}
                        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
                        title={`Tool call ${m + 1}/${agent.toolCalls}`}
                      />,
                    );
                  }
                  return markers;
                })()}

                {/* Stats overlay */}
                <div
                  className="absolute top-0 bottom-0 flex items-center px-2 text-[10px] font-mono text-foreground pointer-events-none"
                  style={{ left: `${left}%`, width: `${width}%`, minWidth: "60px" }}
                >
                  <span className="truncate">
                    {agent.toolCalls} calls
                    {agent.filesChanged.length > 0 && ` / ${agent.filesChanged.length} files`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Communication arrows rendered as dashed lines */}
        {timeline.communications.map((comm, i) => {
          const fromIdx = agentIndexMap.get(comm.from);
          const toIdx = agentIndexMap.get(comm.to);
          if (fromIdx === undefined || toIdx === undefined) return null;

          const xPos = getPosition(comm.timestamp);
          const fromY = fromIdx * (laneHeight + laneGap) + laneHeight / 2;
          const toY = toIdx * (laneHeight + laneGap) + laneHeight / 2;
          const top = Math.min(fromY, toY);
          const height = Math.abs(toY - fromY);

          return (
            <div
              key={`comm-${i}`}
              className="absolute border-l-2 border-dashed border-accent/40 pointer-events-none"
              style={{
                left: `calc(7rem + ${xPos}% * (100% - 7rem) / 100)`,
                top,
                height,
              }}
              title={`${comm.from.slice(0, 8)} -> ${comm.to.slice(0, 8)}: ${comm.summary}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3">
        {Object.entries(agentTypeColors).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`inline-block h-2.5 w-2.5 rounded ${color}`} />
            {type}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded bg-zinc-500" />
          custom
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted ml-2">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-accent/40" />
          message
        </div>
      </div>
    </div>
  );
}
