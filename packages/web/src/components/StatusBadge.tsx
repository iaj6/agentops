import { RunStatus } from "@agentops/core";

const statusColors: Record<string, string> = {
  [RunStatus.Completed]: "bg-green/15 text-green border-green/30",
  [RunStatus.Running]: "bg-blue/15 text-blue border-blue/30",
  [RunStatus.Failed]: "bg-red/15 text-red border-red/30",
  [RunStatus.Blocked]: "bg-yellow/15 text-yellow border-yellow/30",
  [RunStatus.Pending]: "bg-muted/15 text-muted border-muted/30",
  [RunStatus.Cancelled]: "bg-orange/15 text-orange border-orange/30",
};

export function StatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {status}
    </span>
  );
}
