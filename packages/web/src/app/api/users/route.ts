import { NextRequest, NextResponse } from "next/server";
import { listUsers } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Slim user roster used by client filter dropdowns (Events page user
// filter today; future Sessions/Runs filter UIs too). Returns only
// non-secret fields. Any authenticated dashboard user can read this
// — the dashboard's view-scope toggle already lets admins see other
// users' records, so the existence of the roster isn't a new leak.

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  const users = listUsers(db()).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
  }));
  return NextResponse.json({ users });
}
