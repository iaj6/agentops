"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/MetricCard";
import { SuccessChart } from "@/components/SuccessChart";

interface Props {
  successData: { date: string; completed: number; failed: number }[];
  topRepos: { repo: string; count: number }[];
  totalRuns: number;
  totalCompleted: number;
  totalFailed: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface FilesChangedEntry {
  date: string;
  count: number;
}

interface PolicyViolationsEntry {
  date: string;
  count: number;
}

interface DurationEntry {
  date: string;
  avgMs: number;
}

export function AnalyticsDashboard({
  successData,
  topRepos,
  totalRuns,
  totalCompleted,
  totalFailed,
}: Props) {
  const successRate =
    totalCompleted + totalFailed > 0
      ? ((totalCompleted / (totalCompleted + totalFailed)) * 100).toFixed(1)
      : "0";

  const [filesChanged, setFilesChanged] = useState<FilesChangedEntry[]>([]);
  const [policyViolations, setPolicyViolations] = useState<PolicyViolationsEntry[]>([]);
  const [durationData, setDurationData] = useState<DurationEntry[]>([]);

  useEffect(() => {
    fetch("/api/analytics/files-changed")
      .then((r) => r.json())
      .then((data) => setFilesChanged(data))
      .catch(() => {});

    fetch("/api/analytics/policy-violations")
      .then((r) => r.json())
      .then((data) => setPolicyViolations(data))
      .catch(() => {});

    fetch("/api/analytics/duration")
      .then((r) => r.json())
      .then((data) => setDurationData(data))
      .catch(() => {});
  }, []);

  // Compute runs per day from successData
  const runsPerDay = successData.map((d) => ({
    date: d.date,
    count: d.completed + d.failed,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted">Aggregate metrics across all runs</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard label="Total Runs" value={String(totalRuns)} />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${totalCompleted} passed / ${totalFailed} failed`}
        />
        <MetricCard
          label="Completed"
          value={String(totalCompleted)}
          sub={`of ${totalRuns} runs`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SuccessChart data={successData} />
        <RunsPerDayChart data={runsPerDay} />
      </div>

      {/* Middle row: Top Repos + Files Changed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Repos */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Top Repos by Run Count
          </h3>
          <div className="space-y-2">
            {topRepos.map((repo, i) => {
              const maxCount = topRepos[0]?.count ?? 1;
              const pct = (repo.count / maxCount) * 100;
              return (
                <div key={repo.repo} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-foreground">
                      <span className="text-muted mr-2">#{i + 1}</span>
                      {repo.repo}
                    </span>
                    <span className="text-xs text-muted">
                      {repo.count} runs
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-surface-2">
                    <div
                      className="h-1 rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Files Changed Per Day */}
        <DailyBarChart
          title="Files Changed Per Day (30 days)"
          data={filesChanged}
          barColor="var(--accent)"
          emptyMessage="No file edit data available."
        />
      </div>

      {/* Bottom row: Policy Violations + Average Duration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DailyBarChart
          title="Policy Violations Per Day (30 days)"
          data={policyViolations}
          barColor="var(--red)"
          emptyMessage="No policy violation data available."
        />
        <DurationChart data={durationData} />
      </div>
    </div>
  );
}

// ─── Runs Per Day Chart ──────────────────────────────────────────────────────

function RunsPerDayChart({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No run data available.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.count), 1);
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
  const barWidth = Math.max(groupWidth - barGap * 2, 3);

  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = Math.round((maxVal / yTicks) * i);
    return {
      val,
      y: padTop + chartH - (val / maxVal) * chartH,
    };
  });

  const xLabelCount = Math.min(data.length, 6);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1));
    const x = padLeft + idx * groupWidth + groupWidth / 2;
    return { x, label: formatShortDate(data[idx].date) };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Runs Per Day (30 days)
      </h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
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

        {data.map((d, i) => {
          const x = padLeft + i * groupWidth + groupWidth / 2 - barWidth / 2;
          const h = (d.count / maxVal) * chartH;
          return (
            <rect
              key={i}
              x={x}
              y={padTop + chartH - h}
              width={barWidth}
              height={h}
              fill="var(--blue)"
              rx="1"
              opacity="0.85"
            />
          );
        })}

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

// ─── Daily Bar Chart (generic for files changed, policy violations) ─────────

function DailyBarChart({
  title,
  data,
  barColor,
  emptyMessage,
}: {
  title: string;
  data: { date: string; count: number }[];
  barColor: string;
  emptyMessage: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const values = data.map((d) => d.count);
  const maxVal = Math.max(...values, 1);
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
  const barWidth = Math.max(groupWidth - barGap * 2, 3);

  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = Math.round((maxVal / yTicks) * i);
    return {
      val,
      y: padTop + chartH - (val / maxVal) * chartH,
    };
  });

  const xLabelCount = Math.min(data.length, 6);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1));
    const x = padLeft + idx * groupWidth + groupWidth / 2;
    return { x, label: formatShortDate(data[idx].date) };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        {title}
      </h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
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

        {data.map((d, i) => {
          const x = padLeft + i * groupWidth + groupWidth / 2 - barWidth / 2;
          const h = (d.count / maxVal) * chartH;
          return (
            <rect
              key={i}
              x={x}
              y={padTop + chartH - h}
              width={barWidth}
              height={h}
              fill={barColor}
              rx="1"
              opacity="0.85"
            />
          );
        })}

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

// ─── Average Duration Per Day Chart ─────────────────────────────────────────

function DurationChart({ data }: { data: DurationEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No duration data available.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.avgMs), 1);
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
    const y = padTop + chartH - (d.avgMs / maxVal) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`;

  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = (maxVal / yTicks) * i;
    return {
      val,
      y: padTop + chartH - (val / maxVal) * chartH,
      label: formatDuration(val),
    };
  });

  const xLabelCount = Math.min(data.length, 6);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (data.length - 1));
    return { x: points[idx].x, label: formatShortDate(data[idx].date) };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Average Duration Per Day (30 days)
      </h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
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

        <defs>
          <linearGradient id="durationGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--yellow)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--yellow)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#durationGradient)" />
        <path d={linePath} fill="none" stroke="var(--yellow)" strokeWidth="2" strokeLinejoin="round" />

        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--yellow)" stroke="var(--background)" strokeWidth="1" />
        ))}

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
