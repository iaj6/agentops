"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
}

interface UserLite {
  id: string;
  email: string;
  name: string | null;
}

const ACTIONS = [
  "user.login",
  "user.logout",
  "user.added",
  "password.changed",
  "token.issued",
  "token.revoked",
  "device.approved",
  "device.denied",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "policy.toggled",
  "webhook.created",
  "webhook.deleted",
  "webhook.test_sent",
];

const PAGE_SIZE = 50;

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function actionPalette(action: string): string {
  if (action.startsWith("policy.")) return "bg-accent/15 text-accent";
  if (action.startsWith("webhook.")) return "bg-blue/15 text-blue";
  if (action.startsWith("token.") || action.startsWith("device."))
    return "bg-yellow/15 text-yellow";
  if (action === "user.added") return "bg-green/15 text-green";
  if (action.startsWith("password.")) return "bg-red/15 text-red";
  return "bg-muted/15 text-muted";
}

export function AuditSection() {
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const userById = useMemo(() => {
    const m = new Map<string, UserLite>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set("action", actionFilter);
      if (userFilter) params.set("userId", userFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));
      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) {
        setEntries([]);
        return;
      }
      const data = (await res.json()) as {
        entries: AuditEntry[];
        total: number;
        users: UserLite[];
      };
      setEntries(data.entries);
      setUsers(data.users);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, userFilter, page]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Reset to page 0 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [actionFilter, userFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Audit Log</h2>
        <p className="text-xs text-muted mt-1">
          Sensitive operations recorded server-side. Login/logout, user
          invites, password changes, token issuance + revocation, device-flow
          approvals, policy + webhook changes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
          aria-label="Filter by user"
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name?.trim() || u.email}
            </option>
          ))}
        </select>
        {(actionFilter || userFilter) && (
          <button
            type="button"
            onClick={() => {
              setActionFilter("");
              setUserFilter("");
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </div>

      {loading && !entries ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : entries && entries.length === 0 ? (
        <p className="text-sm text-muted">No audit entries match the current filters.</p>
      ) : entries ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  When
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Action
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Actor
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Target
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const user = e.userId ? userById.get(e.userId) : null;
                const actorLabel = e.userId
                  ? user?.name?.trim() || user?.email || e.userId.slice(0, 8)
                  : "anonymous";
                return (
                  <tr
                    key={e.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td
                      className="px-3 py-2 text-xs text-muted whitespace-nowrap"
                      title={new Date(e.timestamp).toLocaleString()}
                    >
                      {formatRelative(e.timestamp)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium ${actionPalette(
                          e.action,
                        )}`}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground">
                      {actorLabel}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted font-mono">
                      {e.targetType ? (
                        <span>
                          {e.targetType}
                          {e.targetId ? `:${e.targetId.slice(0, 12)}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted font-mono">
                      {e.ip ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-border bg-surface px-3 py-1 text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-border bg-surface px-3 py-1 text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
