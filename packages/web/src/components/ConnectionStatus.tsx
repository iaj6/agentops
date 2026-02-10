"use client";

interface ConnectionStatusProps {
  connected: boolean;
  label?: string;
}

export function ConnectionStatus({
  connected,
  label,
}: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            connected ? "bg-green" : "bg-yellow"
          }`}
        />
      </span>
      {label ?? (connected ? "Live" : "Reconnecting...")}
    </div>
  );
}
