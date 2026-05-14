import { NextResponse, type NextRequest } from "next/server";
import { deleteAuthSession } from "@agentops/db";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Read the cookie off the request directly (works in route handlers and
  // in tests) rather than via next/headers cookies() which requires a
  // request scope that isn't established in unit tests.
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) {
    try {
      deleteAuthSession(db(), sessionId);
    } catch {
      // Best-effort. Clearing the cookie is the user-visible thing.
    }
  }
  const res = NextResponse.json({ status: "logged_out" });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
