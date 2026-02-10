export function ScoreBar({
  label,
  score,
  rationale,
}: {
  label: string;
  score: number;
  rationale: string;
}) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8
      ? "bg-green"
      : score >= 0.5
        ? "bg-yellow"
        : "bg-red";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-muted">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-2">
        <div
          className={`h-1.5 rounded-full ${color} animate-score-fill`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted">{rationale}</p>
    </div>
  );
}
