import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  createEvent,
  EventCategory,
  EVENT_TYPES,
} from "@agentops/core";
import { updateRun, insertEvent, getRunMetrics, runMetrics } from "@agentops/db";
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

    // Range-validate the numeric metrics, not just their type. Negative or
    // non-finite values would otherwise be persisted and silently corrupt
    // cost/budget aggregation (a negative costUsd lowers period spend and
    // suppresses budget.warning/breached alerts).
    if (body.costUsd !== undefined) {
      if (typeof body.costUsd !== "number" || !Number.isFinite(body.costUsd) || body.costUsd < 0) {
        return NextResponse.json(
          { error: "costUsd must be a finite number >= 0" },
          { status: 400 },
        );
      }
    }

    if (body.wallTimeMs !== undefined) {
      if (typeof body.wallTimeMs !== "number" || !Number.isFinite(body.wallTimeMs) || body.wallTimeMs < 0) {
        return NextResponse.json(
          { error: "wallTimeMs must be a finite number >= 0" },
          { status: 400 },
        );
      }
    }

    if (body.flakeRate !== undefined) {
      if (typeof body.flakeRate !== "number" || !Number.isFinite(body.flakeRate) || body.flakeRate < 0 || body.flakeRate > 1) {
        return NextResponse.json(
          { error: "flakeRate must be a number between 0 and 1" },
          { status: 400 },
        );
      }
    }

    if (body.tokenUsage !== undefined) {
      const tu = body.tokenUsage;
      const ok =
        tu !== null &&
        typeof tu === "object" &&
        (["input", "output", "total"] as const).every((k) => {
          const n = (tu as Record<string, unknown>)[k];
          return typeof n === "number" && Number.isFinite(n) && n >= 0;
        });
      if (!ok) {
        return NextResponse.json(
          { error: "tokenUsage must be an object with finite, non-negative input/output/total" },
          { status: 400 },
        );
      }
    }

    const tokenUsage = (body.tokenUsage as Record<string, unknown>) ?? {
      input: 0,
      output: 0,
      total: 0,
    };
    const costUsd = (body.costUsd as number) ?? 0;
    const wallTimeMs = (body.wallTimeMs as number) ?? 0;
    const flakeRate = (body.flakeRate as number) ?? 0;

    // Update the run's embedded metrics
    const metrics = {
      tokenUsage: tokenUsage as { input: number; output: number; total: number },
      wallTimeMs,
      costUsd,
      flakeRate,
    };
    updateRun(db(), run.id, {
      metrics,
      updatedAt: new Date().toISOString(),
    });

    // Upsert into run_metrics table
    const existing = getRunMetrics(db(), run.id);
    const now = new Date().toISOString();
    if (existing) {
      db()
        .update(runMetrics)
        .set({
          tokenUsage: tokenUsage as Record<string, unknown>,
          wallTimeMs,
          costCents: costUsd * 100,
          flakeRate,
          recordedAt: now,
        })
        .where(eq(runMetrics.runId, id))
        .run();
    } else {
      db()
        .insert(runMetrics)
        .values({
          id: `rm_${Date.now()}`,
          runId: id,
          tokenUsage: tokenUsage as Record<string, unknown>,
          wallTimeMs,
          costCents: costUsd * 100,
          flakeRate,
          recordedAt: now,
        })
        .run();
    }

    // Emit cost threshold event when cost is reported
    if (costUsd > 0) {
      const event = createEvent(
        EventCategory.Cost,
        EVENT_TYPES["cost.threshold"],
        run.id as string,
        { runId: run.id, costUsd },
      );
      insertEvent(db(), event);
    }

    return NextResponse.json({ runId: run.id });
  } catch (error) {
    return internalError(request, error, "sdk/runs/[id]/metrics");
  }
}
