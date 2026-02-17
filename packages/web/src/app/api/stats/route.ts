import { NextResponse } from "next/server";
import {
  listRunsWithSummaries,
  listSessions,
  countEvents,
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
    const sessActive = allSessions.filter((s) => s.status === "active").length;
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
        successRate,
        avgDuration: Math.round(avgDuration),
      },
      summary: {
        runsToday: runsToday.length,
        runsThisWeek: runsThisWeek.length,
        topRepos,
      },
      sessions: {
        active: sessActive,
        terminated: sessTerminated,
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
