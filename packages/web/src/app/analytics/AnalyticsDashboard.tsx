"use client";

import { MetricCard } from "@/components/MetricCard";
import { CostChart } from "@/components/CostChart";
import { SuccessChart } from "@/components/SuccessChart";
import { StatusBadge } from "@/components/StatusBadge";
import Link from "next/link";

interface Props {
  costData: { date: string; cost: number }[];
  successData: { date: string; completed: number; failed: number }[];
  topRepos: { repo: string; count: number; totalCost: number }[];
  expensiveRuns: {
    id: string;
    goal: string;
    status: string;
    repo: string;
    cost: number;
    duration: number;
  }[];
  totalRuns: number;
  totalCost: number;
  totalCompleted: number;
  totalFailed: number;
  avgDuration: number;
  jobThroughput: { date: string; completed: number }[];
  priorityData: { priority: string; count: number }[];
  sessionActivity: { date: string; active: number }[];
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const priorityColors: Record<string, string> = {
  Critical: "var(--red)",
  High: "var(--orange)",
  Normal: "var(--accent)",
  Low: "var(--muted)",
};

export function AnalyticsDashboard({
  costData,
  successData,
  topRepos,
  expensiveRuns,
  totalRuns,
  totalCost,
  totalCompleted,
  totalFailed,
  avgDuration,
  jobThroughput,
  priorityData,
  sessionActivity,
}: Props) {
  const successRate =
    totalCompleted + totalFailed > 0
      ? ((totalCompleted / (totalCompleted + totalFailed)) * 100).toFixed(1)
      : "0";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted">Aggregate metrics across all runs</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard label="Total Runs" value={String(totalRuns)} />
        <MetricCard label="Total Cost" value={formatCost(totalCost)} />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${totalCompleted} passed / ${totalFailed} failed`}
        />
        <MetricCard label="Avg Duration" value={formatDuration(avgDuration)} />
        <MetricCard
          label="Avg Cost"
          value={formatCost(totalRuns > 0 ? totalCost / totalRuns : 0)}
          sub="per run"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CostChart data={costData} />
        <SuccessChart data={successData} />
      </div>

      {/* Bottom row */}
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
                      {repo.count} runs &middot; {formatCost(repo.totalCost)}
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

        {/* Most Expensive Runs */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
            Most Expensive Runs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3">Run</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3 text-right">Cost</th>
                  <th className="pb-2 text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {expensiveRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-border/50"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-accent hover:underline"
                      >
                        <span className="font-mono text-xs">
                          {run.id.slice(0, 8)}
                        </span>
                      </Link>
                      <p className="text-xs text-muted truncate max-w-[200px]">
                        {truncate(run.goal, 40)}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-foreground">
                      {formatCost(run.cost)}
                    </td>
                    <td className="py-2 text-right font-mono text-xs text-foreground">
                      {formatDuration(run.duration)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Orchestration Section */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Orchestration</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Job Throughput */}
          <JobThroughputChart data={jobThroughput} />

          {/* Session Utilization */}
          <SessionActivityChart data={sessionActivity} />
        </div>

        {/* Jobs by Priority */}
        <div className="mt-4">
          <PriorityBreakdown data={priorityData} />
        </div>
      </div>
    </div>
  );
}

function JobThroughputChart({ data }: { data: { date: string; completed: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No job data available.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.completed), 1);
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
        Job Throughput (30 days)
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
          const h = (d.completed / maxVal) * chartH;
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

function SessionActivityChart({ data }: { data: { date: string; active: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-surface py-16">
        <p className="text-sm text-muted">No session data available.</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.active), 1);
  const width = 600;
  const height = 200;
  const padTop = 20;
  const padBottom = 30;
  const padLeft = 40;
  const padRight = 16;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const points = data.map((d, i) => {
    const x = padLeft + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padTop + chartH - (d.active / maxVal) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`;

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
    return { x: points[idx].x, label: formatShortDate(data[idx].date) };
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Session Utilization (30 days)
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

        <defs>
          <linearGradient id="sessionGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--yellow)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--yellow)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sessionGradient)" />
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

function PriorityBreakdown({ data }: { data: { priority: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          Jobs by Priority
        </h3>
        <p className="py-4 text-center text-sm text-muted">No job data available.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        Jobs by Priority
      </h3>
      {/* Stacked bar */}
      <div className="mb-3 flex h-4 w-full overflow-hidden rounded-full">
        {data.map((d) => {
          const pct = (d.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={d.priority}
              className="h-full"
              style={{
                width: `${pct}%`,
                backgroundColor: priorityColors[d.priority] ?? "var(--muted)",
              }}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {data.map((d) => (
          <span key={d.priority} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: priorityColors[d.priority] ?? "var(--muted)" }}
            />
            {d.priority}: {d.count} ({total > 0 ? Math.round((d.count / total) * 100) : 0}%)
          </span>
        ))}
      </div>
    </div>
  );
}
