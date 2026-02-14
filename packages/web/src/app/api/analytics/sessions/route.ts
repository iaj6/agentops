import { NextResponse } from "next/server";
import { listSessions } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allSessions = listSessions(db(), { limit: 10000 });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build daily active session counts (sessions active on a given day)
    const dailyActive = new Map<string, number>();

    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyActive.set(key, 0);
    }

    for (const session of allSessions) {
      const start = new Date(session.startedAt);
      const end = session.terminatedAt ? new Date(session.terminatedAt) : now;

      for (const [dateStr] of dailyActive) {
        const dayStart = new Date(dateStr);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        if (start < dayEnd && end >= dayStart) {
          dailyActive.set(dateStr, (dailyActive.get(dateStr) ?? 0) + 1);
        }
      }
    }

    const activity = Array.from(dailyActive.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, active]) => ({ date, active }));

    // Status breakdown
    const statusCounts: Record<string, number> = {
      active: 0,
      paused: 0,
      terminated: 0,
    };
    for (const session of allSessions) {
      if (session.status in statusCounts) {
        statusCounts[session.status]++;
      }
    }

    return NextResponse.json({
      activity,
      statusCounts: Object.entries(statusCounts).map(([status, count]) => ({
        status: status.charAt(0).toUpperCase() + status.slice(1),
        count,
      })),
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
