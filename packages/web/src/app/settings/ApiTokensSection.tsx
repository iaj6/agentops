"use client";

import { useEffect, useState } from "react";

interface TokenRow {
  id: string;
  name: string;
  ownerId: string;
  ownerLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ApiTokensSection({
  meRole,
}: {
  meRole: "admin" | "member";
}) {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/tokens");
      if (res.ok) {
        const data = (await res.json()) as { tokens: TokenRow[] };
        setTokens(data.tokens);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function revoke(id: string) {
    setPendingRevoke(id);
    try {
      await fetch(`/api/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      refresh();
    } finally {
      setPendingRevoke(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">API Tokens</h2>
        <p className="text-xs text-muted mt-1">
          {meRole === "admin"
            ? "All tokens across the team. Members see only their own."
            : "Your active tokens."}{" "}
          New tokens are issued by{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">
            agentops login
          </code>{" "}
          (device-flow approval). Revoke here to invalidate immediately.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : !tokens || tokens.length === 0 ? (
        <p className="text-sm text-muted">No active tokens.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Name
                </th>
                {meRole === "admin" && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Owner
                  </th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Created
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Last used
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-foreground">{t.name}</td>
                  {meRole === "admin" && (
                    <td className="px-3 py-2 text-xs text-muted">
                      {t.ownerLabel}
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {formatRelative(t.lastUsedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => revoke(t.id)}
                      disabled={pendingRevoke === t.id}
                      className="rounded-md border border-red/30 bg-red/5 px-2 py-1 text-[11px] font-medium text-red transition-colors hover:bg-red/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingRevoke === t.id ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
