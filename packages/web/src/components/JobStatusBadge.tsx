import { JobStatus } from "@agentops/core";

const statusColors: Record<string, string> = {
  [JobStatus.Queued]: "bg-muted/15 text-muted border-muted/30",
  [JobStatus.Dispatched]: "bg-blue/15 text-blue border-blue/30",
  [JobStatus.Running]: "bg-blue/15 text-blue border-blue/30",
  [JobStatus.Completed]: "bg-green/15 text-green border-green/30",
  [JobStatus.Failed]: "bg-red/15 text-red border-red/30",
  [JobStatus.Cancelled]: "bg-orange/15 text-orange border-orange/30",
};

export function JobStatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? "bg-muted/15 text-muted border-muted/30";
  const isActive = status === JobStatus.Running || status === JobStatus.Dispatched;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {isActive && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue" />
        </span>
      )}
      {status}
    </span>
  );
}
