import { EventCategory } from "@agentops/core";

const categoryColors: Record<string, string> = {
  [EventCategory.Run]: "bg-green/15 text-green border-green/30",
  [EventCategory.Session]: "bg-yellow/15 text-yellow border-yellow/30",
  [EventCategory.Policy]: "bg-red/15 text-red border-red/30",
  [EventCategory.Cost]: "bg-orange/15 text-orange border-orange/30",
  [EventCategory.Action]: "bg-muted/15 text-muted border-muted/30",
};

export function EventCategoryBadge({ category }: { category: string }) {
  const color = categoryColors[category] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {category}
    </span>
  );
}
