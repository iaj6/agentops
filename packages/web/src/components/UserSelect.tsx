"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

interface UserSummary {
  id: string;
  email: string;
  name: string | null;
}

// Admin-only sidebar control. Scopes Runs/Sessions/Analytics to a
// specific user (or "everyone" / "just me"). Pushes either ?userId=<id>
// or ?view=mine onto the current path so SSR pages can scope. Member
// users never see this — they're locked to their own data.
export function UserSelect({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
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
  }, []);

  // Resolve "current" value: explicit ?userId wins (normalize self →
  // "mine"), then ?view=mine, then default "team".
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

  // Sort users alphabetically by display name, falling back to email.
  const sortedUsers = [...users].sort((a, b) => {
    const an = (a.name ?? a.email).toLowerCase();
    const bn = (b.name ?? b.email).toLowerCase();
    return an.localeCompare(bn);
  });

  return (
    <div className="hidden md:block">
      <label
        htmlFor="user-select"
        className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted"
      >
        View
      </label>
      <select
        id="user-select"
        value={current}
        onChange={(e) => setScope(e.target.value)}
        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
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
    </div>
  );
}
