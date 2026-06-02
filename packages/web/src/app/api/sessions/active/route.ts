import { NextResponse, type NextRequest } from "next/server";
import { getActiveSessions } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    const all = getActiveSessions(db());
    // Members (and admins viewing a single user) only see their own active
    // sessions; the unscoped fleet view is admin-only.
    const sessions = scope.userId
      ? all.filter((s) => s.userId === scope.userId)
      : all;
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
