import { NextRequest, NextResponse } from "next/server";
import { addArtifact, createArtifactId } from "@agentops/core";
import type { Artifact } from "@agentops/core";
import { updateRun } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";
import { internalError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownership = await requireOwnedRun(request, id);
    if (ownership instanceof NextResponse) return ownership;
    const { run } = ownership;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Each artifact field must be an array of STRINGS — a non-string element
    // (e.g. an object) is persisted and later crashes the dashboard's
    // DiffViewer (.split on a non-string) or React rendering.
    for (const name of ["diffs", "logs", "testOutputs", "reports"] as const) {
      const value = body[name];
      if (value !== undefined && (!Array.isArray(value) || value.some((el) => typeof el !== "string"))) {
        return NextResponse.json(
          { error: `${name} must be an array of strings` },
          { status: 400 },
        );
      }
    }

    const artifact: Artifact = {
      id: createArtifactId(body.id as string ?? `artifact_${Date.now()}`),
      diffs: (body.diffs as string[]) ?? [],
      logs: (body.logs as string[]) ?? [],
      testOutputs: (body.testOutputs as string[]) ?? [],
      reports: (body.reports as string[]) ?? [],
    };

    const updated = addArtifact(run, artifact);
    updateRun(db(), updated.id, {
      artifacts: updated.artifacts,
      updatedAt: updated.updatedAt,
    });

    return NextResponse.json({ runId: run.id, artifactId: artifact.id });
  } catch (error) {
    return internalError(request, error, "sdk/runs/[id]/artifacts");
  }
}
