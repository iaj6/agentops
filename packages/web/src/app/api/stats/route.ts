import { NextResponse } from "next/server";
import {
  listRunsWithSummaries,
  listJobs,
  countJobsActive,
  countActiveSessions,
  listSessions,
  countEvents,
  listLocks,
} from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = db();

    // Runs (with summaries for aggregate stats)
    const runsWithSummaries = listRunsWithSummaries(d, { limit: 1000 });
    const runs = runsWithSummaries.map((r) => r.run);
    const totalRuns = runs.length;
    const runningRuns = runs.filter((r) => r.status === "running").length;
    const completedRuns = runs.filter((r) => r.status === "completed").length;
    const failedRuns = runs.filter((r) => r.status === "failed").length;
    const successRate =
      completedRuns + failedRuns > 0
        ? Math.round((completedRuns / (completedRuns + failedRuns)) * 1000) / 10
        : 0;
    const totalCost = runs.reduce((s, r) => s + r.metrics.costUsd, 0);
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

    const costToday = runsToday.reduce((s, r) => s + r.metrics.costUsd, 0);
    const costThisWeek = runsThisWeek.reduce((s, r) => s + r.metrics.costUsd, 0);

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

    // Jobs
    const allJobs = listJobs(d, { limit: 10000 });
    const jobQueued = allJobs.filter((j) => j.status === "queued").length;
    const jobDispatched = allJobs.filter((j) => j.status === "dispatched").length;
    const jobRunning = allJobs.filter((j) => j.status === "running").length;
    const jobCompleted = allJobs.filter((j) => j.status === "completed").length;
    const jobFailed = allJobs.filter((j) => j.status === "failed").length;

    // Sessions
    const allSessions = listSessions(d, { limit: 10000 });
    const sessActive = allSessions.filter((s) => s.status === "active").length;
    const sessPaused = allSessions.filter((s) => s.status === "paused").length;
    const sessTerminated = allSessions.filter((s) => s.status === "terminated").length;

    // Events
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const eventsLast24h = countEvents(d, { since: oneDayAgo });
    const eventsLastHour = countEvents(d, { since: oneHourAgo });

    // Locks
    const activeLocks = listLocks(d, { active: true });

    return NextResponse.json({
      runs: {
        total: totalRuns,
        running: runningRuns,
        successRate,
        totalCost: Math.round(totalCost * 100) / 100,
        avgDuration: Math.round(avgDuration),
      },
      summary: {
        runsToday: runsToday.length,
        runsThisWeek: runsThisWeek.length,
        costToday: Math.round(costToday * 100) / 100,
        costThisWeek: Math.round(costThisWeek * 100) / 100,
        topRepos,
      },
      jobs: {
        queued: jobQueued,
        dispatched: jobDispatched,
        running: jobRunning,
        completed: jobCompleted,
        failed: jobFailed,
      },
      sessions: {
        active: sessActive,
        paused: sessPaused,
        terminated: sessTerminated,
      },
      events: {
        last24h: eventsLast24h,
        lastHour: eventsLastHour,
      },
      locks: {
        active: activeLocks.length,
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
