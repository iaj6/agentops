// Small inline chip showing who a run/session belongs to. Used by the
// runs list, sessions list, and detail headers. Resolves to:
//   - The user's name if set (it's an optional column).
//   - The email otherwise.
// Pre-auth records (userId === null) are surfaced as "system" so the
// admin can tell those apart from records owned by a known user.

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

function displayLabel(user: UserSummary | undefined | null): string {
  if (!user) return "system";
  if (user.name && user.name.trim().length > 0) return user.name;
  return user.email;
}

export function UserChip({
  user,
  compact = false,
}: {
  user: UserSummary | undefined | null;
  compact?: boolean;
}) {
  const label = displayLabel(user);
  const isSystem = !user;
  const cls = compact
    ? "inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium"
    : "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";
  const palette = isSystem
    ? "border-muted/30 bg-muted/10 text-muted"
    : "border-accent/30 bg-accent/10 text-accent";
  return (
    <span className={`${cls} ${palette}`} title={user?.email}>
      {label}
    </span>
  );
}
