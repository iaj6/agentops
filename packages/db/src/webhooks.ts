import { desc, eq } from "drizzle-orm";
import type { AgentOpsDb } from "./connection.js";
import { webhooks, webhookDeliveries } from "./schema.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly description: string | null;
  readonly secret: string;
  readonly events: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastDeliveryAt: string | null;
  readonly lastDeliveryStatus: string | null;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly url: string;
  readonly payload: Record<string, unknown>;
  readonly status: "success" | "failed";
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly completedAt: string;
}

interface DbWebhook {
  id: string;
  url: string;
  description: string | null;
  secret: string;
  events: unknown;
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
}

interface DbWebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  url: string;
  payload: unknown;
  status: string;
  attempts: number;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string;
}

function mapWebhook(row: DbWebhook): Webhook {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    secret: row.secret,
    events: Array.isArray(row.events) ? (row.events as string[]) : [],
    enabled: row.enabled,
    createdAt: row.createdAt,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryStatus: row.lastDeliveryStatus,
  };
}

function mapDelivery(row: DbWebhookDelivery): WebhookDelivery {
  const status = row.status === "success" ? "success" : "failed";
  return {
    id: row.id,
    webhookId: row.webhookId,
    eventId: row.eventId,
    eventType: row.eventType,
    url: row.url,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

// ─── Webhook CRUD ──────────────────────────────────────────────────────────

export interface InsertWebhookArgs {
  readonly id: string;
  readonly url: string;
  readonly description?: string | null;
  readonly secret: string;
  readonly events: ReadonlyArray<string>;
  readonly enabled?: boolean;
  readonly createdAt?: string;
}

export function insertWebhook(db: AgentOpsDb, args: InsertWebhookArgs): void {
  db.insert(webhooks)
    .values({
      id: args.id,
      url: args.url,
      description: args.description ?? null,
      secret: args.secret,
      events: args.events as unknown as Record<string, unknown>,
      enabled: args.enabled ?? true,
      createdAt: args.createdAt ?? new Date().toISOString(),
    })
    .run();
}

export function getWebhook(db: AgentOpsDb, id: string): Webhook | null {
  const row = db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, id))
    .get() as DbWebhook | undefined;
  return row ? mapWebhook(row) : null;
}

export function listWebhooks(db: AgentOpsDb): Webhook[] {
  const rows = db.select().from(webhooks).all() as DbWebhook[];
  return rows.map(mapWebhook);
}

export function listEnabledWebhooksForEvent(
  db: AgentOpsDb,
  eventType: string,
): Webhook[] {
  return listWebhooks(db).filter(
    (w) => w.enabled && w.events.includes(eventType),
  );
}

export interface UpdateWebhookArgs {
  readonly url?: string;
  readonly description?: string | null;
  readonly events?: ReadonlyArray<string>;
  readonly enabled?: boolean;
  readonly lastDeliveryAt?: string;
  readonly lastDeliveryStatus?: string;
}

export function updateWebhook(
  db: AgentOpsDb,
  id: string,
  updates: UpdateWebhookArgs,
): void {
  const values: Record<string, unknown> = {};
  if (updates.url !== undefined) values["url"] = updates.url;
  if (updates.description !== undefined) values["description"] = updates.description;
  if (updates.events !== undefined) values["events"] = updates.events as unknown;
  if (updates.enabled !== undefined) values["enabled"] = updates.enabled;
  if (updates.lastDeliveryAt !== undefined)
    values["lastDeliveryAt"] = updates.lastDeliveryAt;
  if (updates.lastDeliveryStatus !== undefined)
    values["lastDeliveryStatus"] = updates.lastDeliveryStatus;

  if (Object.keys(values).length > 0) {
    db.update(webhooks).set(values).where(eq(webhooks.id, id)).run();
  }
}

export function deleteWebhook(db: AgentOpsDb, id: string): void {
  // Deliveries reference webhook_id; remove them first to satisfy FK.
  db.delete(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .run();
  db.delete(webhooks).where(eq(webhooks.id, id)).run();
}

// ─── Delivery records ──────────────────────────────────────────────────────

export interface InsertWebhookDeliveryArgs {
  readonly id: string;
  readonly webhookId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly url: string;
  readonly payload: Record<string, unknown>;
  readonly status: "success" | "failed";
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly completedAt: string;
}

export function insertWebhookDelivery(
  db: AgentOpsDb,
  args: InsertWebhookDeliveryArgs,
): void {
  db.insert(webhookDeliveries)
    .values({
      id: args.id,
      webhookId: args.webhookId,
      eventId: args.eventId,
      eventType: args.eventType,
      url: args.url,
      payload: args.payload as unknown as Record<string, unknown>,
      status: args.status,
      attempts: args.attempts,
      responseStatus: args.responseStatus,
      errorMessage: args.errorMessage,
      createdAt: args.createdAt,
      completedAt: args.completedAt,
    })
    .run();
}

export function listWebhookDeliveries(
  db: AgentOpsDb,
  webhookId: string,
  limit = 50,
): WebhookDelivery[] {
  const rows = db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit)
    .all() as DbWebhookDelivery[];
  return rows.map(mapDelivery);
}
