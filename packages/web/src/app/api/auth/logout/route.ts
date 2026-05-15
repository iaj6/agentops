import { NextResponse, type NextRequest } from "next/server";
import { deleteAuthSession, getUserBySessionId } from "@agentops/db";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Read the cookie off the request directly (works in route handlers and
  // in tests) rather than via next/headers cookies() which requires a
  // request scope that isn't established in unit tests.
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) {
    // Resolve user before deleting the session so the audit row carries
    // the userId. Don't fail logout if the lookup hiccups.
    let userId: string | null = null;
    try {
      userId = getUserBySessionId(db(), sessionId)?.id ?? null;
    } catch {
      /* ignore */
    }
    try {
      deleteAuthSession(db(), sessionId);
    } catch {
      // Best-effort. Clearing the cookie is the user-visible thing.
    }
    if (userId) {
      recordAudit(req, userId, AUDIT_ACTIONS.USER_LOGOUT, {
        targetType: "user",
        targetId: userId,
      });
    }
  }
  const res = NextResponse.json({ status: "logged_out" });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
