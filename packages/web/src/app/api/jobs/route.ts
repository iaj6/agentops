import { NextRequest, NextResponse } from "next/server";
import { listJobs, insertJob } from "@agentops/db";
import { createJob, JobPriority } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get("status") ?? undefined;
    const repo = params.get("repo") ?? undefined;
    const limit = params.get("limit") ? Number(params.get("limit")) : 50;
    const offset = params.get("offset") ? Number(params.get("offset")) : 0;

    const jobs = listJobs(db(), { status, repo, limit, offset });
    return NextResponse.json(jobs);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { goal, repo, branch, priority } = body as {
      goal: string;
      repo?: string;
      branch?: string;
      priority?: string;
    };

    if (!goal || typeof goal !== "string") {
      return NextResponse.json(
        { error: "goal is required and must be a string" },
        { status: 400 },
      );
    }

    const validPriority = (
      Object.values(JobPriority).includes(priority as JobPriority)
        ? priority
        : JobPriority.Normal
    ) as JobPriority;

    const job = createJob(
      {
        humanReadable: goal,
        structured: { type: "task", description: goal, parameters: {} },
      },
      {
        repo: repo ?? "unknown",
        branch: branch ?? "main",
        permissions: [],
        sandbox: { enabled: false, isolationLevel: "none" },
      },
      { priority: validPriority },
    );

    insertJob(db(), job);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
