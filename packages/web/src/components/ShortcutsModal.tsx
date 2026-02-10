"use client";

import { useEffect } from "react";

const shortcuts = [
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["j"], description: "Next row in run list" },
  { keys: ["k"], description: "Previous row in run list" },
  { keys: ["Enter"], description: "Open selected run" },
  { keys: ["Backspace"], description: "Go back to list" },
  { keys: ["Esc"], description: "Close modals / palettes" },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-3">
          {shortcuts.map((s) => (
            <div
              key={s.description}
              className="flex items-center justify-between"
            >
              <span className="text-sm text-muted">{s.description}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border border-border bg-surface-2 px-1.5 text-xs font-mono text-foreground"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-6 py-3">
          <p className="text-xs text-muted text-center">
            Press <kbd className="rounded border border-border bg-surface-2 px-1 text-xs font-mono">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
