"use client";

import type { Session } from "@agentops/core";
import { SessionStatusBadge } from "@/components/SessionStatusBadge";
import { useSessions } from "@/hooks/useSessions";
import Link from "next/link";

export function SessionsTable({ sessions: initialSessions }: { sessions: Session[] }) {
  const { sessions, loading } = useSessions(initialSessions);

  if (loading && sessions.length === 0) {
    return <div className="py-8 text-center text-sm text-muted">Loading sessions...</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Agent
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Current Run
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Completed
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id as string}
              className="border-b border-border last:border-b-0 hover:bg-surface-2 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/sessions/${session.id as string}`}
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {(session.id as string).slice(0, 16)}
                </Link>
              </td>
              <td className="px-4 py-3">
                <SessionStatusBadge status={session.status} />
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted">
                {session.agentId as string}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted">
                {session.currentRunId ? (
                  <Link
                    href={`/runs/${session.currentRunId as string}`}
                    className="text-accent hover:underline"
                  >
                    {(session.currentRunId as string).slice(0, 12)}
                  </Link>
                ) : (
                  <span className="text-muted/50">-</span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted">
                {session.completedRunIds.length}
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(session.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
