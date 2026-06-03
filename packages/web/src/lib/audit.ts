import type { NextRequest } from "next/server";
import { insertAuditLog } from "@agentops/db";
import { db } from "./db";

/**
 * Action vocabulary. Strings are dotted "domain.verb". Keep this list as
 * the source of truth so the audit page filter UI can enumerate.
 */
export const AUDIT_ACTIONS = {
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  USER_ADDED: "user.added",
  PASSWORD_CHANGED: "password.changed",
  TOKEN_ISSUED: "token.issued",
  TOKEN_REVOKED: "token.revoked",
  DEVICE_APPROVED: "device.approved",
  DEVICE_DENIED: "device.denied",
  POLICY_CREATED: "policy.created",
  POLICY_UPDATED: "policy.updated",
  POLICY_DELETED: "policy.deleted",
  POLICY_TOGGLED: "policy.toggled",
  WEBHOOK_CREATED: "webhook.created",
  WEBHOOK_UPDATED: "webhook.updated",
  WEBHOOK_DELETED: "webhook.deleted",
  WEBHOOK_TEST_SENT: "webhook.test_sent",
  BUDGET_SET: "budget.set",
  BUDGET_DELETED: "budget.deleted",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

function extractIp(req: NextRequest): string | null {
  // Trust the standard forwarded headers when the dashboard sits behind
  // Caddy/nginx (the Phase A1 deployment pattern). Falls back to the
  // socket address. Null if neither is available (test env).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return null;
}

/**
 * Record an audit entry. Always fire-and-forget — never let an audit
 * write break the wrapped operation. `req` is optional (the device
 * approval flow has it; some CLI-side paths don't).
 *
 * @param userId  The actor's user id, or null for anonymous attempts.
 * @param action  One of AUDIT_ACTIONS constants.
 * @param opts    targetType / targetId / metadata describing the action.
 */
export function recordAudit(
  req: NextRequest | null,
  userId: string | null,
  action: AuditAction,
  opts: {
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): void {
  insertAuditLog(db(), {
    userId,
    action,
    targetType: opts.targetType ?? null,
    targetId: opts.targetId ?? null,
    ip: req ? extractIp(req) : null,
    metadata: opts.metadata ?? null,
  });
}
