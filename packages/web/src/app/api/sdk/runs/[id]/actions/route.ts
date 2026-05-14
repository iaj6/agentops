import { NextRequest, NextResponse } from "next/server";
import {
  addAction,
  createActionId,
  createEvent,
  EventCategory,
  EVENT_TYPES,
} from "@agentops/core";
import type { Action } from "@agentops/core";
import { updateRun, insertEvent } from "@agentops/db";
import { db } from "@/lib/db";
import { requireOwnedRun } from "@/lib/auth";

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

    if (body.toolCalls !== undefined && !Array.isArray(body.toolCalls)) {
      return NextResponse.json(
        { error: "toolCalls must be an array" },
        { status: 400 },
      );
    }

    if (body.fileEdits !== undefined && !Array.isArray(body.fileEdits)) {
      return NextResponse.json(
        { error: "fileEdits must be an array" },
        { status: 400 },
      );
    }

    if (body.commands !== undefined && !Array.isArray(body.commands)) {
      return NextResponse.json(
        { error: "commands must be an array" },
        { status: 400 },
      );
    }

    const action: Action = {
      id: createActionId(body.id as string ?? `action_${Date.now()}`),
      toolCalls: (body.toolCalls as Action["toolCalls"]) ?? [],
      fileEdits: (body.fileEdits as Action["fileEdits"]) ?? [],
      commands: (body.commands as Action["commands"]) ?? [],
      timestamp: (body.timestamp as string) ?? new Date().toISOString(),
    };

    const updated = addAction(run, action);
    updateRun(db(), updated.id, {
      actions: updated.actions,
      updatedAt: updated.updatedAt,
    });

    const event = createEvent(
      EventCategory.Action,
      EVENT_TYPES["action.taken"],
      run.id as string,
      { runId: run.id, actionId: action.id },
    );
    insertEvent(db(), event);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
