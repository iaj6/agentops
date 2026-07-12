import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  listRuns,
  getRun,
  listEvents,
  createEventPollCursor,
  advanceEventPollCursor,
} from "@agentops/db";
import { createRunId } from "@agentops/core";
import type { Run } from "@agentops/core";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";
import { resolveOwnedSourceIds } from "@/lib/event-scope";

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
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const runIdParam = request.nextUrl.searchParams.get("runId");
    const categoryParam = request.nextUrl.searchParams.get("category");
    const typeParam = request.nextUrl.searchParams.get("type");

    // Resolve view scope at stream start. The user's owned sourceIds
    // are captured here so the poll loop can filter every batch through
    // the scoped set — without this an admin filtered to one user would
    // still stream the team's events back. The ownership set is
    // re-resolved on every poll (cheap indexed lookups) so runs and
    // sessions created after connect appear in the owner's live stream
    // without a reconnect.
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    let scopedSourceIds = resolveOwnedSourceIds(scope.userId);
    let scopedSourceIdSet = scopedSourceIds
      ? new Set(scopedSourceIds)
      : null;

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        // Snapshot: track known state
        const knownRuns = new Map<string, Run>();
        // The cursor pairs an inclusive (gte) `since` boundary with the
        // IDs already emitted at that exact timestamp, so events sharing
        // a timestamp are neither dropped nor re-emitted across polls.
        let eventCursor = createEventPollCursor(new Date().toISOString());

        function loadSnapshot() {
          if (runIdParam) {
            const run = getRun(db(), createRunId(runIdParam));
            if (run) {
              // When the stream is scoped to a user, ignore runs they
              // don't own — single-run subscriptions should not leak
              // through the scope.
              if (
                scopedSourceIdSet &&
                !scopedSourceIdSet.has(run.id as string)
              ) {
                return;
              }
              knownRuns.set(run.id as string, run);
            }
          } else {
            const runs = listRuns(db(), {
              limit: 50,
              ...(scope.userId ? { userId: scope.userId } : {}),
            });
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
            // Refresh the ownership set so entities created after the
            // stream opened are visible to their owner immediately.
            if (scope.userId) {
              scopedSourceIds = resolveOwnedSourceIds(scope.userId);
              scopedSourceIdSet = scopedSourceIds
                ? new Set(scopedSourceIds)
                : null;
            }

            // Poll persisted events from events table
            const eventFilters: {
              since?: string;
              category?: string;
              type?: string;
              sourceIds?: ReadonlyArray<string>;
              limit?: number;
            } = {
              since: eventCursor.since,
              limit: 100,
            };
            if (categoryParam) eventFilters.category = categoryParam;
            if (typeParam) eventFilters.type = typeParam;
            if (scopedSourceIds) eventFilters.sourceIds = scopedSourceIds;

            const batch = listEvents(db(), eventFilters);
            const { fresh, next } = advanceEventPollCursor(
              eventCursor,
              batch,
            );
            eventCursor = next;
            for (const evt of fresh) {
              controller.enqueue(
                encoder.encode(sseMessage(evt.type, evt)),
              );
            }

            // Backward compat: still detect run changes via diffing
            if (runIdParam) {
              const current = getRun(db(), createRunId(runIdParam));
              if (!current) return;
              // Don't leak run updates outside the user's scope.
              if (
                scopedSourceIdSet &&
                !scopedSourceIdSet.has(current.id as string)
              ) {
                return;
              }

              const prev = knownRuns.get(current.id as string);
              const eventType = detectEventType(prev, current);

              if (eventType) {
                controller.enqueue(
                  encoder.encode(sseMessage(eventType, current)),
                );
                knownRuns.set(current.id as string, current);
              }
            } else {
              const currentRuns = listRuns(db(), {
                limit: 50,
                ...(scope.userId ? { userId: scope.userId } : {}),
              });
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
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
