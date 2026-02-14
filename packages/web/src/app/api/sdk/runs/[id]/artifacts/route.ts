import { NextRequest, NextResponse } from "next/server";
import { addArtifact, createRunId, createArtifactId } from "@agentops/core";
import type { Artifact } from "@agentops/core";
import { getRun, updateRun } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const run = getRun(db(), createRunId(id));
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.diffs !== undefined && !Array.isArray(body.diffs)) {
      return NextResponse.json(
        { error: "diffs must be an array" },
        { status: 400 },
      );
    }

    if (body.logs !== undefined && !Array.isArray(body.logs)) {
      return NextResponse.json(
        { error: "logs must be an array" },
        { status: 400 },
      );
    }

    if (body.testOutputs !== undefined && !Array.isArray(body.testOutputs)) {
      return NextResponse.json(
        { error: "testOutputs must be an array" },
        { status: 400 },
      );
    }

    if (body.reports !== undefined && !Array.isArray(body.reports)) {
      return NextResponse.json(
        { error: "reports must be an array" },
        { status: 400 },
      );
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
