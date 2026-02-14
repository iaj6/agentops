import { NextRequest, NextResponse } from "next/server";
import { cancelJob, createJobId, createEvent, EventCategory } from "@agentops/core";
import { getJob, updateJob, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getJob(db(), createJobId(id));
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
      return NextResponse.json(
        { error: `Cannot cancel job with status "${job.status}"` },
        { status: 400 },
      );
    }

    const cancelled = cancelJob(job);
    updateJob(db(), cancelled.id, {
      status: cancelled.status,
      updatedAt: cancelled.updatedAt,
    });

    const event = createEvent(
      EventCategory.Job,
      "job.cancelled",
      cancelled.id as string,
      { jobId: cancelled.id },
    );
    insertEvent(db(), event);

    return NextResponse.json(cancelled);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
