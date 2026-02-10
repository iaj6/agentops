"use client";

import { useRef, useEffect } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onCommandPalette: () => void;
  resultCount?: number;
  totalCount?: number;
}

export function SearchBar({
  value,
  onChange,
  onCommandPalette,
  resultCount,
  totalCount,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K or Ctrl+K focuses the search or opens command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onCommandPalette();
      }
      // "/" focuses search bar
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCommandPalette]);

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <svg
          className="pointer-events-none absolute left-3 text-muted"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search runs... (/ to focus, Cmd+K for palette)"
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-20 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="absolute right-3 flex items-center gap-2">
          {resultCount !== undefined && totalCount !== undefined && (
            <span className="text-xs text-muted">
              {resultCount} of {totalCount}
            </span>
          )}
          <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted sm:inline-block">
            /
          </kbd>
        </div>
      </div>
    </div>
  );
}
