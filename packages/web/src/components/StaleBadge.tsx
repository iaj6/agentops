// Small inline pill marking a run or session as "stale" — still in a live
// status (running / active) but hasn't heartbeat / updated in a long time.
// Almost always means the hook crashed or the session predates the cleanup
// flow being installed. The badge sits next to the status pill so the
// admin can spot ghosts at a glance.

export function StaleBadge({ compact = false }: { compact?: boolean }) {
  const cls = compact
    ? "inline-flex items-center rounded-full border border-yellow/30 bg-yellow/10 px-1.5 py-0 text-[10px] font-medium text-yellow"
    : "inline-flex items-center rounded-full border border-yellow/30 bg-yellow/10 px-2 py-0.5 text-xs font-medium text-yellow";
  return (
    <span
      className={cls}
      title="No heartbeat in 30+ minutes — likely a crashed or abandoned session."
    >
      stale
    </span>
  );
}
