"use client";

import { useEffect, useState } from "react";
import type { Toast as ToastData, ToastType } from "@/hooks/useToast";
import { useToast } from "@/hooks/useToast";

const typeStyles: Record<ToastType, string> = {
  success: "border-green/40 bg-green/10 text-green",
  error: "border-red/40 bg-red/10 text-red",
  warning: "border-yellow/40 bg-yellow/10 text-yellow",
  info: "border-blue/40 bg-blue/10 text-blue",
};

const typeIcons: Record<ToastType, string> = {
  success: "\u2713",
  error: "\u2717",
  warning: "!",
  info: "i",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      onClick={() => onDismiss(toast.id)}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm cursor-pointer transition-all duration-300 ${
        typeStyles[toast.type]
      } ${visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-current/15 text-xs font-bold">
        {typeIcons[toast.type]}
      </span>
      <span className="text-sm">{toast.message}</span>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
