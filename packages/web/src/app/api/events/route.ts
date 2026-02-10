import { NextRequest } from "next/server";
import { listRuns, getRun } from "@agentops/db";
import { createRunId } from "@agentops/core";
import type { Run } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function ssePing(): string {
  return `: ping\n\n`;
}

function detectEventType(
  prev: Run | undefined,
  current: Run,
): string | null {
  if (!prev) return "run_created";
  if (prev.updatedAt === current.updatedAt) return null;
  if (current.status === "completed" && prev.status !== "completed")
    return "run_completed";
  if (current.status === "failed" && prev.status !== "failed")
    return "run_failed";
  return "run_updated";
}

export async function GET(request: NextRequest) {
  const runIdParam = request.nextUrl.searchParams.get("runId");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Snapshot: track known state
      const knownRuns = new Map<string, Run>();

      function loadSnapshot() {
        if (runIdParam) {
          const run = getRun(db(), createRunId(runIdParam));
          if (run) {
            knownRuns.set(run.id as string, run);
          }
        } else {
          const runs = listRuns(db(), { limit: 50 });
          for (const run of runs) {
            knownRuns.set(run.id as string, run);
          }
        }
      }

      // Initial snapshot
      loadSnapshot();

      // Send initial connected event
      try {
        controller.enqueue(
          encoder.encode(sseMessage("connected", { timestamp: new Date().toISOString() })),
        );
      } catch {
        closed = true;
        return;
      }

      // Poll interval for changes
      const pollInterval = setInterval(() => {
        if (closed) {
          clearInterval(pollInterval);
          return;
        }

        try {
          if (runIdParam) {
            const current = getRun(db(), createRunId(runIdParam));
            if (!current) return;

            const prev = knownRuns.get(current.id as string);
            const eventType = detectEventType(prev, current);

            if (eventType) {
              controller.enqueue(
                encoder.encode(sseMessage(eventType, current)),
              );
              knownRuns.set(current.id as string, current);
            }
          } else {
            const currentRuns = listRuns(db(), { limit: 50 });
            const currentMap = new Map<string, Run>();
            for (const run of currentRuns) {
              currentMap.set(run.id as string, run);
            }

            // Detect new and changed runs
            for (const [id, run] of currentMap) {
              const prev = knownRuns.get(id);
              const eventType = detectEventType(prev, run);
              if (eventType) {
                controller.enqueue(
                  encoder.encode(sseMessage(eventType, run)),
                );
              }
            }

            // Replace snapshot
            knownRuns.clear();
            for (const [id, run] of currentMap) {
              knownRuns.set(id, run);
            }
          }
        } catch {
          // DB error during poll - skip this cycle
        }
      }, 2000);

      // Keep-alive ping every 15 seconds
      const pingInterval = setInterval(() => {
        if (closed) {
          clearInterval(pingInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(ssePing()));
        } catch {
          closed = true;
          clearInterval(pingInterval);
          clearInterval(pollInterval);
        }
      }, 15000);

      // Listen for client disconnect
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollInterval);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
