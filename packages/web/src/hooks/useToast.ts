"use client";

import { useState, useEffect, useRef } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

let globalId = 0;

const listeners = new Set<(toasts: Toast[]) => void>();
let globalToasts: Toast[] = [];

function emit() {
  for (const fn of listeners) fn(globalToasts);
}

function addToast(message: string, type: ToastType = "info"): string {
  const id = `toast-${++globalId}`;
  globalToasts = [...globalToasts, { id, message, type }];
  emit();

  setTimeout(() => {
    dismissToast(id);
  }, 5000);

  return id;
}

function dismissToast(id: string) {
  globalToasts = globalToasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, type: ToastType = "info") {
  return addToast(message, type);
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(globalToasts);
  const handlerRef = useRef<((t: Toast[]) => void) | undefined>(undefined);

  useEffect(() => {
    const handler = (t: Toast[]) => setToasts(t);
    handlerRef.current = handler;
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return {
    toasts,
    toast: addToast,
    dismiss: dismissToast,
  };
}
