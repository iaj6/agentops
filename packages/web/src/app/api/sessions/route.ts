import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const params = request.nextUrl.searchParams;
    const scope = resolveViewScope(user, params);
    const status = params.get("status") ?? undefined;
    const limit = params.get("limit") ? Number(params.get("limit")) : 50;
    const offset = params.get("offset") ? Number(params.get("offset")) : 0;

    const sessions = listSessions(db(), {
      status,
      limit,
      offset,
      // Apply the same view scope the SSR page used so client hydration
      // doesn't silently fall back to the unscoped fleet view.
      ...(scope.userId ? { userId: scope.userId } : {}),
    });
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
