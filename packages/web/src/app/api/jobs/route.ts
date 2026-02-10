import { NextRequest, NextResponse } from "next/server";
import { listJobs, insertJob } from "@agentops/db";
import { createJob, JobPriority } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? undefined;
  const repo = params.get("repo") ?? undefined;
  const limit = params.get("limit") ? Number(params.get("limit")) : 50;
  const offset = params.get("offset") ? Number(params.get("offset")) : 0;

  const jobs = listJobs(db(), { status, repo, limit, offset });
  return NextResponse.json(jobs);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { goal, repo, branch, priority } = body as {
    goal: string;
    repo?: string;
    branch?: string;
    priority?: string;
  };

  if (!goal) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
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
}
