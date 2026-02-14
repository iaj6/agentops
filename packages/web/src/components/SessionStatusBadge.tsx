import { SessionStatus } from "@agentops/core";

const statusColors: Record<string, string> = {
  [SessionStatus.Active]: "bg-green/15 text-green border-green/30",
  [SessionStatus.Provisioning]: "bg-blue/15 text-blue border-blue/30",
  [SessionStatus.Terminated]: "bg-red/15 text-red border-red/30",
};

export function SessionStatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? "bg-muted/15 text-muted border-muted/30";
  const isActive = status === SessionStatus.Active;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {isActive && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
        </span>
      )}
      {status}
    </span>
  );
}
