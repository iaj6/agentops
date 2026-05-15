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

export function useStats(): UseStatsReturn {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { stats, loading };
}
