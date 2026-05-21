"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

interface UserSummary {
  id: string;
  email: string;
  name: string | null;
}

interface Props {
  currentUserId: string;
  /** Hide entirely when the viewer can't change scope (members). */
  canSelect: boolean;
}

// Per-page user-scope filter. Members are locked to their own data, so
// they don't see this at all. Admins get an Everyone / Just me / specific
// user selector. The selection is encoded in the URL as ?userId=<id> or
// ?view=mine and the page reads it via resolveViewScope.
export function UserFilter({ currentUserId, canSelect }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    if (!canSelect) return;
    let cancelled = false;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data: { users?: UserSummary[] }) => {
        if (!cancelled) setUsers(data.users ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSelect]);

  if (!canSelect) return null;

  const userIdParam = searchParams.get("userId");
  const viewParam = searchParams.get("view");
  const current =
    userIdParam && userIdParam !== currentUserId
      ? userIdParam
      : userIdParam === currentUserId || viewParam === "mine"
        ? "__mine__"
        : "__team__";

  function setScope(value: string) {
    if (value === current) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("view");
    next.delete("userId");
    if (value === "__mine__") next.set("view", "mine");
    else if (value !== "__team__") next.set("userId", value);
    const qs = next.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  const sortedUsers = [...users].sort((a, b) => {
    const an = (a.name ?? a.email).toLowerCase();
    const bn = (b.name ?? b.email).toLowerCase();
    return an.localeCompare(bn);
  });

  const activeLabel =
    current === "__team__"
      ? "Everyone"
      : current === "__mine__"
        ? "Just me"
        : (sortedUsers.find((u) => u.id === current)?.name ??
           sortedUsers.find((u) => u.id === current)?.email ??
           "Filtered");

  return (
    <label className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted">User:</span>
      <span className="relative">
        <select
          aria-label="Filter by user"
          value={current}
          onChange={(e) => setScope(e.target.value)}
          className={`appearance-none rounded-full border px-3 py-1 pr-7 text-xs transition-colors ${
            current === "__team__"
              ? "border-border bg-surface text-muted hover:text-foreground"
              : "border-accent bg-accent/15 text-accent"
          }`}
        >
          <option value="__team__">Everyone</option>
          <option value="__mine__">Just me</option>
          {sortedUsers.length > 0 && <option disabled>──────────</option>}
          {sortedUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted"
        >
          ▾
        </span>
      </span>
      <span className="sr-only">Showing: {activeLabel}</span>
    </label>
  );
}
