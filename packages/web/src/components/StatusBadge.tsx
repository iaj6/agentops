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
  const isRunning = status === RunStatus.Running;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {isRunning && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue" />
        </span>
      )}
      {status}
    </span>
  );
}
