import { NextResponse } from "next/server";
import {
  listRunsWithSummaries,
  listSessions,
  countEvents,
} from "@agentops/db";
import { isStaleRun, isStaleSession } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = db();

    // Runs (with summaries for aggregate stats)
    const runsWithSummaries = listRunsWithSummaries(d, { limit: 1000 });
    const runs = runsWithSummaries.map((r) => r.run);
    const totalRuns = runs.length;
    // Split "running" into active + stale. The stale bucket exists because
    // crashed sessions leave the run in "running" forever — counting them
    // toward "Running Now" misleads the operator. Stale is defined by the
    // core helper (~30 minutes without an update).
    const nowMs = Date.now();
    const runningAll = runs.filter((r) => r.status === "running");
    const staleRunningRuns = runningAll.filter((r) => isStaleRun(r, undefined, nowMs)).length;
    const runningRuns = runningAll.length - staleRunningRuns;
    const completedRuns = runs.filter((r) => r.status === "completed").length;
    const failedRuns = runs.filter((r) => r.status === "failed").length;
    const successRate =
      completedRuns + failedRuns > 0
        ? Math.round((completedRuns / (completedRuns + failedRuns)) * 1000) / 10
        : 0;
    const avgDuration =
      totalRuns > 0
        ? runs.reduce((s, r) => s + r.metrics.wallTimeMs, 0) / totalRuns
        : 0;

    // Summary-based aggregate stats
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const runsToday = runs.filter((r) => r.createdAt >= todayStart);
    const runsThisWeek = runs.filter((r) => r.createdAt >= weekAgo);

    // Cost rollup (summed from run.metrics.costUsd — already populated by
    // the hook from the local Claude Code transcript). Today + week totals
    // mirror the run count windows so the dashboard hero is readable at a
    // glance.
    const sumCost = (rs: typeof runs): number =>
      rs.reduce((s, r) => s + (r.metrics.costUsd || 0), 0);
    const costTotal = sumCost(runs);
    const costToday = sumCost(runsToday);
    const costWeek = sumCost(runsThisWeek);

    // Most active repos from summaries
    const repoCounts: Record<string, number> = {};
    for (const r of runsThisWeek) {
      const repo = r.environment.repo;
      repoCounts[repo] = (repoCounts[repo] ?? 0) + 1;
    }
    const topRepos = Object.entries(repoCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([repo, count]) => ({ repo, count }));

    // Sessions
    const allSessions = listSessions(d, { limit: 10000 });
    const activeAll = allSessions.filter((s) => s.status === "active");
    const sessStale = activeAll.filter((s) => isStaleSession(s, undefined, nowMs)).length;
    const sessActive = activeAll.length - sessStale;
    const sessTerminated = allSessions.filter((s) => s.status === "terminated").length;

    // Events
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const eventsLast24h = countEvents(d, { since: oneDayAgo });
    const eventsLastHour = countEvents(d, { since: oneHourAgo });

    return NextResponse.json({
      runs: {
        total: totalRuns,
        running: runningRuns,
        stale: staleRunningRuns,
        successRate,
        avgDuration: Math.round(avgDuration),
      },
      summary: {
        runsToday: runsToday.length,
        runsThisWeek: runsThisWeek.length,
        topRepos,
      },
      cost: {
        total: costTotal,
        today: costToday,
        week: costWeek,
      },
      sessions: {
        active: sessActive,
        terminated: sessTerminated,
        stale: sessStale,
      },
      events: {
        last24h: eventsLast24h,
        lastHour: eventsLastHour,
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
