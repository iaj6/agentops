"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Run, Session, SessionSummary } from "@agentops/core";
import { StatusBadge } from "@/components/StatusBadge";
import { TimeAgo } from "@/components/TimeAgo";

interface RunWithSummary {
  run: Run;
  summary: SessionSummary | null;
}

interface Violation {
  policyName: string;
  message: string;
  runId: string;
  evaluatedAt: string;
}

interface Props {
  userName: string;
  userEmail: string;
  recentRuns: RunWithSummary[];
  activeSessions: Session[];
  weekCostUsd: number;
  monthCostUsd: number;
  weekRunCount: number;
  monthRunCount: number;
  sparkData: number[];
  recentViolations: Violation[];
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// First name only for the headline. Falls back to whatever we got
// if the name is a single token already.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function HomeDashboard({
  userName,
  userEmail,
  recentRuns,
  activeSessions,
  weekCostUsd,
  monthCostUsd,
  weekRunCount,
  monthRunCount,
  sparkData,
  recentViolations,
}: Props) {
  const hour = new Date().getHours();
  const greeting = greetingFor(hour);
  const first = firstName(userName);

  // One-line status under the greeting — picks the most "live" thing
  // we know about the user right now.
  const statusLine = useMemo(() => {
    if (activeSessions.length > 0) {
      const n = activeSessions.length;
      return `${n} live session${n === 1 ? "" : "s"} on the wire.`;
    }
    if (weekRunCount > 0) {
      return `${weekRunCount} run${weekRunCount === 1 ? "" : "s"} this week · ${formatCost(weekCostUsd)} spent.`;
    }
    return "Quiet week. Kick off a Claude Code session whenever you're ready.";
  }, [activeSessions.length, weekRunCount, weekCostUsd]);

  return (
    <div className="p-6 space-y-6">
      {/* ── Hero: greeting + metrics, asymmetric two-column ─────────────── */}
      <Hero
        greeting={greeting}
        first={first}
        statusLine={statusLine}
        weekCostUsd={weekCostUsd}
        monthCostUsd={monthCostUsd}
        weekRunCount={weekRunCount}
        monthRunCount={monthRunCount}
        activeCount={activeSessions.length}
        sparkData={sparkData}
      />

      {/* ── Active sessions strip (only when something's live) ──────────── */}
      {activeSessions.length > 0 && (
        <ActiveSessions sessions={activeSessions} />
      )}

      {/* ── Bottom: recent runs + alerts/quick links sidebar ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <RecentRuns runs={recentRuns} />
        </div>
        <div className="lg:col-span-4 space-y-4">
          {recentViolations.length > 0 && (
            <ViolationsPanel violations={recentViolations} />
          )}
          <QuickLinks userEmail={userEmail} />
        </div>
      </div>
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({
  greeting,
  first,
  statusLine,
  weekCostUsd,
  monthCostUsd,
  weekRunCount,
  monthRunCount,
  activeCount,
  sparkData,
}: {
  greeting: string;
  first: string;
  statusLine: string;
  weekCostUsd: number;
  monthCostUsd: number;
  weekRunCount: number;
  monthRunCount: number;
  activeCount: number;
  sparkData: number[];
}) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface">
      {/* Atmospheric backdrop — only on Home. Tiny radial that hints
          at "landing here" without competing with content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse 60% 80% at 0% 0%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 60%)",
        }}
      />
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 md:p-8">
        {/* Left: greeting + status + sparkline */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Home
            </p>
            <h1 className="mt-2 text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
              {greeting},{" "}
              <span className="text-accent">{first}</span>
              <span className="text-muted">.</span>
            </h1>
            <p className="mt-3 text-sm text-muted max-w-md">{statusLine}</p>
          </div>

          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-2">
              Last 14 days
            </p>
            <Sparkline data={sparkData} />
          </div>
        </div>

        {/* Right: 4 metric tiles in a tight 2x2 */}
        <div className="lg:col-span-7 grid grid-cols-2 gap-3">
          <HeroMetric
            label="This week"
            value={formatCost(weekCostUsd)}
            sub={`${weekRunCount} run${weekRunCount === 1 ? "" : "s"}`}
            accent={weekRunCount > 0}
          />
          <HeroMetric
            label="Month to date"
            value={formatCost(monthCostUsd)}
            sub={`${monthRunCount} run${monthRunCount === 1 ? "" : "s"}`}
          />
          <HeroMetric
            label="Active sessions"
            value={String(activeCount)}
            sub={activeCount > 0 ? "running now" : "none"}
            live={activeCount > 0}
          />
          <HeroMetric
            label="Avg cost / run"
            value={
              weekRunCount > 0
                ? formatCost(weekCostUsd / weekRunCount)
                : "—"
            }
            sub="this week"
          />
        </div>
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  live,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  live?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-2/60 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
          {label}
        </p>
        {live && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
          </span>
        )}
      </div>
      <p
        className={`mt-1.5 text-2xl font-semibold font-mono ${
          accent ? "text-foreground" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const width = 220;
  const height = 32;
  const gap = 2;
  const barW = Math.max((width - gap * (data.length - 1)) / data.length, 2);

  const hasData = data.some((v) => v > 0);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[280px] h-8"
      preserveAspectRatio="none"
      aria-label="Daily run count over the last 14 days"
    >
      {data.map((v, i) => {
        const h = hasData ? Math.max((v / max) * height, v > 0 ? 2 : 1) : 1;
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx="0.5"
            fill={
              v > 0 ? "var(--accent)" : "var(--border)"
            }
            opacity={v > 0 ? 0.9 : 1}
          />
        );
      })}
    </svg>
  );
}

// ─── Active sessions strip ─────────────────────────────────────────────────

function ActiveSessions({ sessions }: { sessions: Session[] }) {
  return (
    <section className="rounded-lg border border-green/30 bg-gradient-to-r from-green/[0.06] to-transparent p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-green">
          Running now
        </h2>
        <span className="text-xs text-muted">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {sessions.map((s) => {
          const budgetLeft = s.resourceUsage?.costBudgetRemaining;
          return (
            <li key={s.id as string}>
              <Link
                href={`/sessions/${s.id}`}
                className="flex items-center gap-3 rounded-md border border-border/60 bg-surface/60 px-3 py-2 hover:border-green/40 hover:bg-surface transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate font-mono">
                    {s.agentId as string}
                  </p>
                  <p className="text-xs text-muted">
                    started <TimeAgo date={s.startedAt ?? s.createdAt} />
                  </p>
                </div>
                {typeof budgetLeft === "number" && budgetLeft > 0 && (
                  <span
                    className="text-xs font-mono text-muted"
                    title="cost budget remaining"
                  >
                    {formatCost(budgetLeft)} left
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Recent runs ───────────────────────────────────────────────────────────

function RecentRuns({ runs }: { runs: RunWithSummary[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Recent runs
        </h2>
        <Link
          href="/runs?view=mine"
          className="text-xs text-accent hover:underline"
        >
          View all →
        </Link>
      </header>
      {runs.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm text-foreground">No runs yet.</p>
          <p className="mt-1 text-xs text-muted">
            Start a Claude Code session with hooks installed to see your
            runs here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map(({ run }) => {
            const cost = run.metrics?.costUsd ?? 0;
            const repo = run.environment?.repo ?? "—";
            return (
              <li key={run.id as string}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 transition-colors"
                >
                  <StatusBadge status={run.status} />
                  <span className="flex-1 min-w-0 text-sm font-mono text-foreground truncate">
                    {repo}
                  </span>
                  <span className="hidden sm:inline text-xs text-muted">
                    <TimeAgo date={run.createdAt} />
                  </span>
                  <span className="text-xs font-mono text-muted w-16 text-right">
                    {cost > 0 ? formatCost(cost) : "—"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Violations panel ──────────────────────────────────────────────────────

function ViolationsPanel({ violations }: { violations: Violation[] }) {
  return (
    <section className="rounded-lg border border-red/25 bg-surface">
      <header className="flex items-center justify-between px-4 py-3 border-b border-red/15">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-red">
          Heads up — policy
        </h2>
        <span className="text-xs text-muted">{violations.length}</span>
      </header>
      <ul className="divide-y divide-border">
        {violations.map((v, i) => (
          <li key={`${v.runId}-${i}`}>
            <Link
              href={`/runs/${v.runId}`}
              className="block px-4 py-3 hover:bg-surface-2/50 transition-colors"
            >
              <p className="text-xs font-medium text-foreground truncate">
                {v.policyName}
              </p>
              <p className="mt-0.5 text-xs text-muted line-clamp-2">
                {v.message}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                <TimeAgo date={v.evaluatedAt} />
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Quick links ───────────────────────────────────────────────────────────

function QuickLinks({ userEmail }: { userEmail: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        Jump to
      </h2>
      <ul className="space-y-1.5 text-sm">
        <QuickLink href="/runs" label="All runs" />
        <QuickLink href="/sessions" label="All sessions" />
        <QuickLink href="/analytics" label="Analytics" />
        <QuickLink href="/settings" label="Settings" />
      </ul>
      <p className="mt-4 text-[10px] text-muted truncate" title={userEmail}>
        Signed in as {userEmail}
      </p>
    </section>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between rounded px-2 py-1 -mx-2 text-foreground hover:bg-surface-2/60 transition-colors"
      >
        <span>{label}</span>
        <span className="text-muted group-hover:text-accent transition-colors">
          →
        </span>
      </Link>
    </li>
  );
}
