"use client";

import { useState, useCallback } from "react";
import { toast } from "./useToast";

interface UseActionOptions {
  onSuccess?: (data: unknown) => void;
  successMessage?: string;
  errorMessage?: string;
}

interface UseActionReturn {
  execute: (url: string, body?: unknown) => Promise<boolean>;
  loading: boolean;
}

export function useAction(options: UseActionOptions = {}): UseActionReturn {
  const [loading, setLoading] = useState(false);

  const execute = useCallback(
    async (url: string, body?: unknown): Promise<boolean> => {
      setLoading(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          toast(options.errorMessage ?? err.error ?? "Action failed", "error");
          return false;
        }

        const data = await res.json();
        if (options.successMessage) {
          toast(options.successMessage, "success");
        }
        options.onSuccess?.(data);
        return true;
      } catch {
        toast(options.errorMessage ?? "Network error", "error");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  return { execute, loading };
}
