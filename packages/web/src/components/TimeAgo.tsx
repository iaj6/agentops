"use client";

import { useEffect, useState } from "react";

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TimeAgo({ date }: { date: string }) {
  const [text, setText] = useState(formatTimeAgo(date));

  useEffect(() => {
    const interval = setInterval(() => {
      setText(formatTimeAgo(date));
    }, 30000);
    return () => clearInterval(interval);
  }, [date]);

  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {text}
    </time>
  );
}
