"use client";

import { useState, useEffect, useCallback } from "react";

interface StatsData {
  runs: { total: number; running: number; successRate: number; totalCost: number; avgDuration: number };
  summary: { runsToday: number; runsThisWeek: number; costToday: number; costThisWeek: number; topRepos: { repo: string; count: number }[] };
  jobs: { queued: number; dispatched: number; running: number; completed: number; failed: number };
  sessions: { active: number; paused: number; terminated: number };
  events: { last24h: number; lastHour: number };
  locks: { active: number };
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
