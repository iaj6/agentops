import type { ResourceUsage } from "@agentops/core";

function Bar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color =
    pct > 80 ? "bg-red" : pct > 50 ? "bg-yellow" : "bg-green";

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-foreground">
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2">
        <div
          className={`h-2 rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ResourceUsageBar({ usage }: { usage: ResourceUsage }) {
  return (
    <div className="space-y-3">
      <Bar label="Memory" value={usage.memoryMb} max={2048} unit="MB" />
      <Bar label="CPU" value={usage.cpuPercent} max={100} unit="%" />
      <Bar label="Token Budget" value={usage.tokensBudgetRemaining} max={500000} unit="tokens" />
      <Bar label="Cost Budget" value={usage.costBudgetRemaining} max={50} unit="USD" />
    </div>
  );
}
