"use client";

interface DataPoint {
  date: string;
  cost: number;
}

export function CostChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No cost data available.</p>
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.cost), 0.01);
  const width = 600;
  const height = 200;
  const padTop = 20;
  const padBottom = 30;
  const padLeft = 50;
  const padRight = 16;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const points = data.map((d, i) => {
    const x = padLeft + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padTop + chartH - (d.cost / maxCost) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`;

  // Y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = (maxCost / yTicks) * i;
    return {
      val,
      y: padTop + chartH - (val / maxCost) * chartH,
      label: val < 1 ? `$${val.toFixed(2)}` : `$${val.toFixed(1)}`,
    };
  });

  // X-axis labels (show a few dates)
  const xLabelCount = Math.min(data.length, 6);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1));
    return {
      x: points[idx].x,
      label: formatShortDate(data[idx].date),
    };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Cost Over Time (30 days)
      </h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((tick, i) => (
          <g key={i}>
            <line
              x1={padLeft}
              y1={tick.y}
              x2={width - padRight}
              y2={tick.y}
              stroke="var(--border)"
              strokeWidth="0.5"
            />
            <text
              x={padLeft - 6}
              y={tick.y + 3}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#costGradient)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--accent)" stroke="var(--background)" strokeWidth="1" />
        ))}

        {/* X-axis labels */}
        {xLabels.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={height - 6}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="9"
            fontFamily="var(--font-mono)"
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
