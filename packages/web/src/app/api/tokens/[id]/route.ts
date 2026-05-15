import { NextRequest, NextResponse } from "next/server";
import { getApiTokenById, revokeApiToken } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Revoke an API token. Members can revoke their own; admins can revoke
// anyone's. Returns 404 (not 403) on cross-user attempts so the route
// doesn't leak which token IDs exist.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireUser(request);
  if (me instanceof NextResponse) return me;

  const { id } = await params;
  const d = db();
  const token = getApiTokenById(d, id);
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }
  if (me.role !== "admin" && token.userId !== me.id) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  revokeApiToken(d, id);
  return NextResponse.json({ ok: true });
}
