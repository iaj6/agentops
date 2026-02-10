import { JobPriority } from "@agentops/core";

const priorityColors: Record<string, string> = {
  [JobPriority.Critical]: "bg-red/15 text-red border-red/30",
  [JobPriority.High]: "bg-orange/15 text-orange border-orange/30",
  [JobPriority.Normal]: "bg-muted/15 text-muted border-muted/30",
  [JobPriority.Low]: "bg-muted/10 text-muted/70 border-muted/20",
};

export function PriorityBadge({ priority }: { priority: string }) {
  const color = priorityColors[priority] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {priority}
    </span>
  );
}
