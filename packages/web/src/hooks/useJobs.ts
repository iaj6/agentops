"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Job } from "@agentops/core";

interface UseJobsReturn {
  jobs: Job[];
  loading: boolean;
  /** Set of job IDs that were recently updated (for highlight animation) */
  recentlyUpdated: Set<string>;
}

export function useJobs(initialJobs: Job[]): UseJobsReturn {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [loading, setLoading] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(
    new Set(),
  );
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Fetch initial data from API
  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      setLoading(true);
      try {
        const res = await fetch("/api/jobs?limit=50");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setJobs(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchJobs();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll for updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/jobs?limit=50");
        if (res.ok) {
          const data = await res.json();
          setJobs((prev) => {
            const prevIds = new Set(prev.map((j) => j.id as string));
            const newIds = new Set((data as Job[]).map((j) => j.id as string));
            // Mark updated jobs
            for (const job of data as Job[]) {
              const jobId = job.id as string;
              const existing = prev.find((j) => (j.id as string) === jobId);
              if (!existing || existing.updatedAt !== job.updatedAt) {
                markUpdated(jobId);
              }
            }
            return data;
          });
        }
      } catch {
        // Ignore fetch errors during polling
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const markUpdated = useCallback((jobId: string) => {
    setRecentlyUpdated((prev) => new Set(prev).add(jobId));

    const existing = timeoutsRef.current.get(jobId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      setRecentlyUpdated((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      timeoutsRef.current.delete(jobId);
    }, 3000);
    timeoutsRef.current.set(jobId, timeout);
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    };
  }, []);

  return { jobs, loading, recentlyUpdated };
}
