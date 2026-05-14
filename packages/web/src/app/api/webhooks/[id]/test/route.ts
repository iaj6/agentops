import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getWebhook } from "@agentops/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

export const dynamic = "force-dynamic";

// POST /api/webhooks/:id/test
//
// Sends a synthetic policy.violated event so the customer can confirm
// their receiver works. Returns immediately — the delivery record is
// what the dashboard surfaces afterwards.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const webhook = getWebhook(db(), id);
  if (!webhook) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const testEvent = {
    id: `evt_test_${randomUUID().slice(0, 8)}`,
    // Force the dispatcher to consider this webhook, even if the
    // configured event list is empty for some reason — the receiver
    // wants to see the round-trip, not a filter decision.
    type: webhook.events[0] ?? "policy.violated",
    payload: {
      test: true,
      message: "AgentOps webhook test ping",
      sentBy: user.email,
    },
    timestamp: new Date().toISOString(),
  };

  // Wait for the delivery to complete so the response can return the
  // resulting status — test pings are user-driven, the user wants a
  // synchronous "did it work" answer.
  await dispatchWebhookEvent(db(), testEvent);

  return NextResponse.json({ ok: true, eventId: testEvent.id });
}
