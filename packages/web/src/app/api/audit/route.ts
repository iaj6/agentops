import { NextRequest, NextResponse } from "next/server";
import { countAuditLogs, listAuditLogs, listUsers } from "@agentops/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/audit?action=X&userId=Y&since=ISO&until=ISO&limit=N&offset=M
//
// Admin-only. Returns audit log entries newest-first plus a sidecar
// user lookup so the page can render names without a follow-up fetch.

export async function GET(request: NextRequest) {
  const me = await requireAdmin(request);
  if (me instanceof NextResponse) return me;

  const params = request.nextUrl.searchParams;
  const action = params.get("action") ?? undefined;
  const userId = params.get("userId") ?? undefined;
  const since = params.get("since") ?? undefined;
  const until = params.get("until") ?? undefined;
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") ?? "50", 10), 1),
    500,
  );
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10), 0);

  const filters = { action, userId, since, until, limit, offset };
  const entries = listAuditLogs(db(), filters);
  const total = countAuditLogs(db(), filters);

  // Resolve userIds → display labels server-side so the page doesn't
  // need a second roundtrip. Tiny payload.
  const users = listUsers(db()).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
  }));

  return NextResponse.json({ entries, total, users });
}
