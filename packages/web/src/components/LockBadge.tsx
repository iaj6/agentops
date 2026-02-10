import { LockType } from "@agentops/core";

const lockTypeColors: Record<string, string> = {
  [LockType.Repo]: "bg-blue/15 text-blue border-blue/30",
  [LockType.Path]: "bg-purple/15 text-purple border-purple/30",
  [LockType.Branch]: "bg-orange/15 text-orange border-orange/30",
};

export function LockBadge({ lockType }: { lockType: string }) {
  const color = lockTypeColors[lockType] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {lockType}
    </span>
  );
}
