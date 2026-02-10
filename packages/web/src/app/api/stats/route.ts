import { NextResponse } from "next/server";
import {
  listRuns,
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
  const d = db();

  // Runs
  const runs = listRuns(d, { limit: 1000 });
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
  const now = new Date();
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
}
