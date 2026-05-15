import { NextResponse, type NextRequest } from "next/server";
import {
  deleteWebhook,
  getWebhook,
  listWebhookDeliveries,
  updateWebhook,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
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

  const deliveries = listWebhookDeliveries(db(), id, 50);
  const last4 = webhook.secret.length >= 4 ? webhook.secret.slice(-4) : webhook.secret;
  const { secret: _ignored, ...rest } = webhook;
  void _ignored;
  return NextResponse.json({
    ...rest,
    secretLast4: last4,
    deliveries,
  });
}

interface PatchBody {
  url?: unknown;
  description?: unknown;
  events?: unknown;
  enabled?: unknown;
}

const KNOWN_EVENT_TYPES = new Set(["policy.violated"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const existing = getWebhook(db(), id);
  if (!existing) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: {
    url?: string;
    description?: string | null;
    events?: string[];
    enabled?: boolean;
  } = {};

  if (body.url !== undefined) {
    if (typeof body.url !== "string") {
      return NextResponse.json(
        { error: "url must be a string" },
        { status: 400 },
      );
    }
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json(
          { error: "url must be http:// or https://" },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json({ error: "url is not a valid URL" }, { status: 400 });
    }
    updates.url = body.url;
  }

  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string" ? body.description : null;
  }

  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return NextResponse.json(
        { error: "events must be a non-empty array" },
        { status: 400 },
      );
    }
    const events = (body.events as unknown[]).filter(
      (e): e is string => typeof e === "string",
    );
    const unknown = events.filter((e) => !KNOWN_EVENT_TYPES.has(e));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unsupported event types: ${unknown.join(", ")}` },
        { status: 400 },
      );
    }
    updates.events = events;
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    updates.enabled = body.enabled;
  }

  updateWebhook(db(), id, updates);
  const updated = getWebhook(db(), id);
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const existing = getWebhook(db(), id);
  if (!existing) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }
  deleteWebhook(db(), id);
  recordAudit(req, user.id, AUDIT_ACTIONS.WEBHOOK_DELETED, {
    targetType: "webhook",
    targetId: id,
    metadata: { url: existing.url },
  });
  return NextResponse.json({ ok: true });
}
