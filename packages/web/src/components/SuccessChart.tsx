"use client";

interface DataPoint {
  date: string;
  completed: number;
  failed: number;
}

export function SuccessChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No run data available.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.completed + d.failed), 1);
  const width = 600;
  const height = 200;
  const padTop = 20;
  const padBottom = 30;
  const padLeft = 40;
  const padRight = 16;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const barGap = 2;
  const groupWidth = chartW / data.length;
  const barWidth = Math.max((groupWidth - barGap * 2) / 2, 3);

  // Y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = Math.round((maxVal / yTicks) * i);
    return {
      val,
      y: padTop + chartH - (val / maxVal) * chartH,
    };
  });

  // X-axis labels
  const xLabelCount = Math.min(data.length, 6);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1));
    const x = padLeft + idx * groupWidth + groupWidth / 2;
    return { x, label: formatShortDate(data[idx].date) };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Run Success Rate (30 days)
      </h3>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-green" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-red" />
          Failed
        </span>
      </div>
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
              {tick.val}
            </text>
          </g>
        ))}

        {/* Stacked bars */}
        {data.map((d, i) => {
          const x = padLeft + i * groupWidth + groupWidth / 2 - barWidth / 2;
          const completedH = (d.completed / maxVal) * chartH;
          const failedH = (d.failed / maxVal) * chartH;
          return (
            <g key={i}>
              {/* Completed (bottom) */}
              <rect
                x={x}
                y={padTop + chartH - completedH - failedH}
                width={barWidth}
                height={completedH}
                fill="var(--green)"
                rx="1"
                opacity="0.85"
              />
              {/* Failed (top) */}
              <rect
                x={x}
                y={padTop + chartH - failedH}
                width={barWidth}
                height={failedH}
                fill="var(--red)"
                rx="1"
                opacity="0.85"
              />
            </g>
          );
        })}

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
