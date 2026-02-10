export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-surface-2 ${className}`}
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Header */}
      <div className="flex gap-4 border-b border-border bg-surface px-4 py-3">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-12" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-14" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-4 py-3"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

export function CardRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Skeleton className="mb-3 h-3 w-36" />
      <Skeleton className="h-[200px] w-full rounded" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Skeleton className="h-3 w-20" />
      {/* Title row */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {/* Subtitle */}
      <Skeleton className="h-4 w-64" />
      {/* Meta */}
      <div className="flex gap-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      {/* Metric cards */}
      <CardRowSkeleton count={4} />
      {/* Content blocks */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full rounded" />
      </div>
    </div>
  );
}
