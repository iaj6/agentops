import type { RunStatus } from "@agentops/core";

// ─── Colors (ANSI escape codes) ─────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function colorStatus(status: string): string {
  switch (status) {
    case "completed":
      return green(status);
    case "failed":
    case "cancelled":
      return red(status);
    case "blocked":
    case "pending":
      return yellow(status);
    case "running":
      return green(status);
    default:
      return status;
  }
}

export function colorBool(passed: boolean): string {
  return passed ? green("PASS") : red("FAIL");
}

// ─── Table rendering ────────────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    const colValues = rows.map((r) => stripAnsi(r[i] ?? "").length);
    return Math.max(h.length, ...colValues);
  });

  const sep = widths.map((w) => "-".repeat(w + 2)).join("+");
  const headerLine = headers
    .map((h, i) => ` ${h.padEnd(widths[i]!)} `)
    .join("|");

  const bodyLines = rows.map((row) =>
    row
      .map((cell, i) => {
        const visible = stripAnsi(cell).length;
        const pad = (widths[i] ?? 0) - visible;
        return ` ${cell}${" ".repeat(Math.max(0, pad))} `;
      })
      .join("|"),
  );

  return [headerLine, sep, ...bodyLines].join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
