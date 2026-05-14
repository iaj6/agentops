// Outbound webhook dispatcher.
//
// On `policy.violated` (or any future subscribable event), look up the
// matching webhook subscriptions and POST an HMAC-signed payload. One
// retry on 5xx. Each end-state is recorded in `webhook_deliveries` so
// the dashboard can surface why a webhook isn't firing.
//
// Called via `void dispatchWebhookEvent(...)` so the originating request
// is not delayed by network IO to the receiver.

import { createHmac, randomUUID } from "node:crypto";
import {
  insertWebhookDelivery,
  listEnabledWebhooksForEvent,
  updateWebhook,
  type AgentOpsDb,
  type Webhook,
} from "@agentops/db";
import { log } from "@/lib/log";

export interface WebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

// Injectable fetch + delay let us drive the retry path in tests without
// real timers / real network IO.
export interface DispatcherDeps {
  readonly fetch?: typeof fetch;
  readonly delay?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly retryDelayMs?: number;
}

const DEFAULT_RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SIGNATURE_HEADER = "X-AgentOps-Signature";

export function signPayload(secret: string, body: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

function isRetryable(status: number): boolean {
  // 5xx + 429 — anything that's likely transient on the receiver side.
  return status >= 500 || status === 429;
}

interface AttemptResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly error: string | null;
}

async function attempt(
  url: string,
  body: string,
  signature: string,
  event: WebhookEvent,
  fetchImpl: typeof fetch,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgentOps-Webhooks/1",
        [SIGNATURE_HEADER]: signature,
        "X-AgentOps-Event": event.type,
        "X-AgentOps-Delivery-Id": event.id,
      },
      body,
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Single webhook: try once, retry once on 5xx/429. Record the outcome.
// Errors here are swallowed — a misconfigured receiver should not crash
// the originating API route.
async function deliverOne(
  db: AgentOpsDb,
  webhook: Webhook,
  event: WebhookEvent,
  deps: Required<DispatcherDeps>,
): Promise<void> {
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    data: event.payload,
  });
  const signature = signPayload(webhook.secret, body);
  const createdAt = deps.now().toISOString();

  let attempts = 0;
  let lastResult: AttemptResult = { ok: false, status: null, error: "no-attempt" };

  for (let i = 0; i < 2; i++) {
    attempts++;
    lastResult = await attempt(
      webhook.url,
      body,
      signature,
      event,
      deps.fetch,
    );
    if (lastResult.ok) break;
    const status = lastResult.status;
    // 4xx (except 429) is the receiver's fault — don't retry.
    if (status !== null && !isRetryable(status)) break;
    if (i === 0) await deps.delay(deps.retryDelayMs);
  }

  const completedAt = deps.now().toISOString();
  const finalStatus: "success" | "failed" = lastResult.ok ? "success" : "failed";

  try {
    insertWebhookDelivery(db, {
      id: `whd_${randomUUID().slice(0, 12)}`,
      webhookId: webhook.id,
      eventId: event.id,
      eventType: event.type,
      url: webhook.url,
      payload: event.payload,
      status: finalStatus,
      attempts,
      responseStatus: lastResult.status,
      errorMessage: lastResult.error,
      createdAt,
      completedAt,
    });
    updateWebhook(db, webhook.id, {
      lastDeliveryAt: completedAt,
      lastDeliveryStatus: finalStatus,
    });
  } catch (dbErr) {
    log.error({
      msg: "webhook.delivery.persist_failed",
      webhookId: webhook.id,
      eventId: event.id,
      err: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  // `outcome` rather than `status` here — LogFields reserves `status`
  // for HTTP status codes.
  const fields = {
    msg: "webhook.delivery",
    webhookId: webhook.id,
    eventId: event.id,
    eventType: event.type,
    outcome: finalStatus,
    attempts,
    responseStatus: lastResult.status,
  };
  if (finalStatus === "success") log.info(fields);
  else log.warn(fields);
}

// Public entry point. Resolves AFTER all deliveries complete — callers
// should `void` this so it doesn't block the originating request.
export async function dispatchWebhookEvent(
  db: AgentOpsDb,
  event: WebhookEvent,
  deps: DispatcherDeps = {},
): Promise<void> {
  const resolved: Required<DispatcherDeps> = {
    fetch: deps.fetch ?? fetch,
    delay: deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: deps.now ?? (() => new Date()),
    retryDelayMs: deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  };

  let subscribers: Webhook[];
  try {
    subscribers = listEnabledWebhooksForEvent(db, event.type);
  } catch (err) {
    log.error({
      msg: "webhook.dispatch.lookup_failed",
      eventId: event.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (subscribers.length === 0) return;

  // Fire all subscribers in parallel. Failures in one don't block the others.
  await Promise.all(
    subscribers.map((w) =>
      deliverOne(db, w, event, resolved).catch((err) => {
        log.error({
          msg: "webhook.dispatch.unexpected_error",
          webhookId: w.id,
          eventId: event.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );
}
