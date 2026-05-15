"use client";

import { useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="text-xs text-muted">{label}</p>;
}

function InviteResult({
  user,
  password,
  onDismiss,
}: {
  user: { email: string };
  password: string;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Created account for {user.email}
          </p>
          <p className="mt-1 text-xs text-muted">
            Share this one-time password with them out of band. They'll be
            prompted to change it on first sign-in. This is the only time
            it's shown.
          </p>
          <div className="mt-2 rounded bg-surface-2 p-2 font-mono text-sm text-foreground select-all">
            {password}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function UsersSection({
  meRole,
}: {
  meRole: "admin" | "member";
}) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<
    { user: { email: string }; password: string } | null
  >(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = (await res.json()) as { users: UserRow[] };
        setUsers(data.users);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName || undefined,
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        user: { email: string };
        tempPassword: string;
      };
      setLastInvite({ user: data.user, password: data.tempPassword });
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Users</h2>
          <p className="text-xs text-muted mt-1">
            Team members with dashboard access. Sign-in uses email + password;
            CLI hooks use API tokens issued via{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[11px]">
              agentops login
            </code>
            .
          </p>
        </div>
        {meRole === "admin" && (
          <button
            type="button"
            onClick={() => {
              setShowInvite((v) => !v);
              setError(null);
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            {showInvite ? "Cancel" : "Invite user"}
          </button>
        )}
      </div>

      {showInvite && meRole === "admin" && (
        <form
          onSubmit={submitInvite}
          className="rounded-lg border border-border bg-surface-2 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-muted">Email</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@acme.com"
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Name (optional)</span>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Doe"
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Role</span>
              <select
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as "admin" | "member")
                }
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          {error && <p className="text-xs text-red">{error}</p>}
          <div>
            <button
              type="submit"
              disabled={submitting || !inviteEmail}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent/90"
            >
              {submitting ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      )}

      {lastInvite && (
        <InviteResult
          user={lastInvite.user}
          password={lastInvite.password}
          onDismiss={() => setLastInvite(null)}
        />
      )}

      {loading ? (
        <Spinner />
      ) : !users || users.length === 0 ? (
        <p className="text-sm text-muted">No users yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Name
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Email
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Role
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-foreground">
                    {u.name?.trim() || (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">
                    {u.email}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        u.role === "admin"
                          ? "bg-accent/15 text-accent"
                          : "bg-muted/15 text-muted"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(u.createdAt).toLocaleDateString()}
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
