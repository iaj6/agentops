"use client";

import type { AgentNode } from "@agentops/core";

const agentTypeColors: Record<string, { bg: string; text: string; border: string }> = {
  Explore: { bg: "bg-blue-500/15", text: "text-blue-500", border: "border-blue-500/30" },
  "general-purpose": { bg: "bg-green-500/15", text: "text-green-500", border: "border-green-500/30" },
  Plan: { bg: "bg-purple-500/15", text: "text-purple-500", border: "border-purple-500/30" },
  Bash: { bg: "bg-orange-500/15", text: "text-orange-500", border: "border-orange-500/30" },
};

const defaultColor = { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/30" };

function getAgentColor(agentType: string) {
  return agentTypeColors[agentType] ?? defaultColor;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "running";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

export function AgentCard({ agent, isRoot }: { agent: AgentNode; isRoot?: boolean }) {
  const color = getAgentColor(agent.agentType);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text} ${color.border}`}
        >
          {agent.agentType}
        </span>
        {isRoot && (
          <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            lead
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-muted">
          {agent.agentId.slice(0, 12)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted">Duration</span>
          <p className="font-mono text-foreground">
            {formatDuration(agent.spawnedAt, agent.completedAt)}
          </p>
        </div>
        <div>
          <span className="text-muted">Tool calls</span>
          <p className="font-mono text-foreground">{agent.toolCalls}</p>
        </div>
        <div>
          <span className="text-muted">Files touched</span>
          <p className="font-mono text-foreground">{agent.filesChanged.length}</p>
        </div>
        <div>
          <span className="text-muted">Commands</span>
          <p className="font-mono text-foreground">{agent.commands.length}</p>
        </div>
      </div>
      {agent.filesChanged.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-xs text-muted mb-1">Files</p>
          <div className="space-y-0.5">
            {agent.filesChanged.slice(0, 5).map((f) => (
              <p key={f} className="font-mono text-xs text-foreground truncate">{f}</p>
            ))}
            {agent.filesChanged.length > 5 && (
              <p className="text-xs text-muted">+{agent.filesChanged.length - 5} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
