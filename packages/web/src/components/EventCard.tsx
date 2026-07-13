"use client";

import { useState } from "react";
import type { AgentEvent } from "@agentops/core";
import { EventCategoryBadge } from "./EventCategoryBadge";
import { TimeAgo } from "./TimeAgo";
import Link from "next/link";

function getSourceLink(sourceId: string): { href: string; label: string } | null {
  if (sourceId.startsWith("session_")) {
    return { href: `/sessions/${sourceId}`, label: sourceId };
  }
  if (sourceId.startsWith("run_")) {
    return { href: `/runs/${sourceId}`, label: sourceId };
  }
  return null;
}

/**
 * Extract the set of policy IDs referenced by a policy.violated event
 * so the EventCard can render direct links to /policies/<id>. The payload
 * may carry either:
 *   - `policyId` (string) — single-policy events (run-completion path)
 *   - `policyIds` (string[]) — pre-tool path emits one event per fire
 *     with possibly multiple violations
 * Legacy events that pre-date B4/B8 carry neither; we render no link
 * for those and the user can still expand the payload to see the name.
 */
function getPolicyLinks(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof payload.policyId === "string") out.push(payload.policyId);
  if (Array.isArray(payload.policyIds)) {
    for (const id of payload.policyIds) {
      if (typeof id === "string" && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function EventCard({ event }: { event: AgentEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = Object.keys(event.payload).length > 0;
  const sourceLink = getSourceLink(event.sourceId);
  const policyLinks =
    event.type === "policy.violated" ? getPolicyLinks(event.payload) : [];

  return (
    <div
      className={`rounded-lg border border-border bg-card transition-colors ${hasPayload ? "cursor-pointer hover:bg-surface-2" : ""}`}
      onClick={() => hasPayload && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <EventCategoryBadge category={event.category} />
            <span className="text-sm font-medium text-foreground">{event.type}</span>
            {hasPayload && (
              <svg
                className={`h-3.5 w-3.5 text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              Source:{" "}
              {sourceLink ? (
                <Link
                  href={sourceLink.href}
                  onClick={(e) => e.stopPropagation()}
                  className="text-accent hover:underline"
                >
                  {sourceLink.label}
                </Link>
              ) : (
                event.sourceId
              )}
            </span>
            {policyLinks.length > 0 && (
              <span>
                Polic{policyLinks.length === 1 ? "y" : "ies"}:{" "}
                {policyLinks.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/policies/${id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-accent hover:underline"
                    >
                      {id}
                    </Link>
                  </span>
                ))}
              </span>
            )}
            <TimeAgo date={event.timestamp} />
          </div>
        </div>
        <span className="text-xs text-muted shrink-0 font-mono">{(event.id as string).slice(0, 12)}</span>
      </div>
      {expanded && hasPayload && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <pre className="rounded bg-muted/10 p-3 text-xs text-muted overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
