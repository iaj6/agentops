"use client";

import { useState } from "react";

/**
 * Tiny copy-to-clipboard button. Used inline next to long IDs (run, session,
 * etc.) so the operator can grab the full string without manually selecting
 * the truncated display value. Shows a brief "Copied" confirmation.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard requires a secure context or user gesture; if
      // it's unavailable, just silently fail — falling back to "select the
      // text" is good enough for the operator.
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}: ${value}`}
      aria-label={label}
      className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
