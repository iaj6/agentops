import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { insertWebhook, listWebhooks, type Webhook } from "@agentops/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { validateOutboundUrl } from "@/lib/ssrf";

export const dynamic = "force-dynamic";

// Only event types the dispatcher currently knows how to fire on. v1 has
// one — adding more later is just expanding this list + emitting at the
// right call site (no schema change needed; events is a JSON array).
const KNOWN_EVENT_TYPES = new Set(["policy.violated"]);

// Last 4 of the secret in list responses — enough to confirm "yes, this
// is the webhook I configured" without echoing the signing key back. The
// secret is only ever exposed in full as the response to POST (once).
function redactSecret(w: Webhook): Omit<Webhook, "secret"> & { secretLast4: string } {
  const last4 = w.secret.length >= 4 ? w.secret.slice(-4) : w.secret;
  const { secret: _unused, ...rest } = w;
  void _unused;
  return { ...rest, secretLast4: last4 };
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;
  const all = listWebhooks(db());
  return NextResponse.json(all.map(redactSecret));
}

interface CreateBody {
  url?: unknown;
  description?: unknown;
  events?: unknown;
  secret?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.url !== "string" || body.url.length === 0) {
    return NextResponse.json(
      { error: "url is required and must be a string" },
      { status: 400 },
    );
  }
  const urlCheck = validateOutboundUrl(body.url);
  if (!urlCheck.ok) {
    return NextResponse.json(
      { error: `Invalid webhook url: ${urlCheck.reason}` },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json(
      { error: "events is required and must be a non-empty array" },
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

  const description =
    typeof body.description === "string" ? body.description : null;

  // Accept a user-supplied secret (so customers with a pre-existing
  // receiver can keep their key) or generate one. 32 bytes of urandom is
  // 256 bits — plenty for HMAC-SHA256.
  const secret =
    typeof body.secret === "string" && body.secret.length >= 16
      ? body.secret
      : `whsec_${randomBytes(32).toString("hex")}`;

  const id = `wh_${randomUUID().slice(0, 12)}`;
  insertWebhook(db(), {
    id,
    url: body.url,
    description,
    secret,
    events,
    enabled: true,
  });

  recordAudit(req, user.id, AUDIT_ACTIONS.WEBHOOK_CREATED, {
    targetType: "webhook",
    targetId: id,
    metadata: { url: body.url, events },
  });

  return NextResponse.json(
    {
      id,
      url: body.url,
      description,
      events,
      enabled: true,
      // Returned exactly ONCE so the customer can stash it server-side.
      // Subsequent reads only echo the last 4.
      secret,
    },
    { status: 201 },
  );
}
