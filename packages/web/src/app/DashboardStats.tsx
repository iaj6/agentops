"use client";

import { MetricCard } from "@/components/MetricCard";

interface Stats {
  totalRuns: string;
  running: string;
  successRate: string;
  totalCost: string;
  avgDuration: string;
}

export function DashboardStats({ stats }: { stats: Stats }) {
  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <MetricCard label="Total Runs" value={stats.totalRuns} />
      <MetricCard label="Running Now" value={stats.running} />
      <MetricCard label="Success Rate" value={stats.successRate} />
      <MetricCard label="Total Cost" value={stats.totalCost} />
      <MetricCard label="Avg Duration" value={stats.avgDuration} />
    </div>
  );
}
