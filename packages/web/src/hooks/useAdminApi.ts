"use client";
import { useState, useEffect, useCallback, useRef } from "react";

interface AdminStatus {
  configured: boolean;
}

interface CostData {
  [key: string]: unknown;
}

interface AnalyticsData {
  [key: string]: unknown;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export function useAdminStatus() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch("/api/admin/status");
        if (!res.ok) return;
        const json: AdminStatus = await res.json();
        if (!cancelled) {
          setConfigured(json.configured);
        }
      } catch {
        // Silently fail - configured stays false
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return { configured, loading };
}

export function useAdminCost(startDate?: string, endDate?: string) {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<CacheEntry<CostData> | null>(null);
  const cacheKeyRef = useRef<string>("");

  const fetchCost = useCallback(async () => {
    const cacheKey = `cost:${startDate ?? ""}:${endDate ?? ""}`;

    // Check cache
    if (
      cacheRef.current &&
      cacheKeyRef.current === cacheKey &&
      Date.now() - cacheRef.current.fetchedAt < CACHE_TTL_MS
    ) {
      setData(cacheRef.current.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const queryString = params.toString();
      const url = `/api/admin/cost${queryString ? `?${queryString}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json: CostData = await res.json();
      cacheRef.current = { data: json, fetchedAt: Date.now() };
      cacheKeyRef.current = cacheKey;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchCost();
  }, [fetchCost]);

  return { data, loading, error };
}

export function useAdminAnalytics(startDate?: string, endDate?: string) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<CacheEntry<AnalyticsData> | null>(null);
  const cacheKeyRef = useRef<string>("");

  const fetchAnalytics = useCallback(async () => {
    const cacheKey = `analytics:${startDate ?? ""}:${endDate ?? ""}`;

    // Check cache
    if (
      cacheRef.current &&
      cacheKeyRef.current === cacheKey &&
      Date.now() - cacheRef.current.fetchedAt < CACHE_TTL_MS
    ) {
      setData(cacheRef.current.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const queryString = params.toString();
      const url = `/api/admin/analytics${queryString ? `?${queryString}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (errBody as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json: AnalyticsData = await res.json();
      cacheRef.current = { data: json, fetchedAt: Date.now() };
      cacheKeyRef.current = cacheKey;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return { data, loading, error };
}
