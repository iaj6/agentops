"use client";

import { useState, useEffect, useCallback } from "react";

interface StatsData {
  runs: {
    total: number;
    running: number;
    stale: number;
    successRate: number;
    avgDuration: number;
  };
  summary: { runsToday: number; runsThisWeek: number; topRepos: { repo: string; count: number }[] };
  cost: { total: number; today: number; week: number };
  sessions: { active: number; terminated: number; stale: number };
  events: { last24h: number; lastHour: number };
}

interface UseStatsReturn {
  stats: StatsData | null;
  loading: boolean;
}

export function useStats(scope?: {
  view?: string | null;
  userId?: string | null;
}): UseStatsReturn {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Stable key so re-renders with new {} prop don't churn the effect.
  const scopeKey = `${scope?.view ?? ""}|${scope?.userId ?? ""}`;

  const fetchStats = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (scope?.view) p.set("view", scope.view);
      if (scope?.userId) p.set("userId", scope.userId);
      const qs = p.toString();
      const res = await fetch(`/api/stats${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, loading };
}
