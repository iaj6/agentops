import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { deleteAuthSession } from "@agentops/db";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
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
