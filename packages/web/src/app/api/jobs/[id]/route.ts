import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@agentops/db";
import { createJobId, cancelJob, retryJob } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getJob(db(), createJobId(id));
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getJob(db(), createJobId(id));
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action } = body as { action: string };

    if (action === "cancel") {
      const cancelled = cancelJob(job);
      updateJob(db(), cancelled.id, {
        status: cancelled.status,
        updatedAt: cancelled.updatedAt,
      });
      return NextResponse.json(cancelled);
    }

    if (action === "retry") {
      const retried = retryJob(job);
      updateJob(db(), retried.id, {
        status: retried.status,
        attempt: retried.attempt,
        sessionId: retried.sessionId,
        dispatchedAt: retried.dispatchedAt,
        updatedAt: retried.updatedAt,
      });
      return NextResponse.json(retried);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
