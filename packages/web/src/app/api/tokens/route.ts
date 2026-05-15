import { NextRequest, NextResponse } from "next/server";
import {
  listAllApiTokens,
  listApiTokensForUser,
  listUsers,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// List API tokens. Members see their own; admins see everyone's. The
// response is hash-free — the raw token is only ever returned once at
// issue time (during the device-flow approval). Here we surface the
// metadata an operator needs to revoke confidently: name, who owns it,
// when it was issued, and when it was last used.

export async function GET(request: NextRequest) {
  const me = await requireUser(request);
  if (me instanceof NextResponse) return me;

  const d = db();
  const rows = me.role === "admin"
    ? listAllApiTokens(d)
    : listApiTokensForUser(d, me.id);

  // Resolve userId → display label (name or email) for the admin view.
  // Members only see their own tokens so this is just a courtesy in the
  // member path (still resolves to themselves).
  const users = me.role === "admin" ? listUsers(d) : [me];
  const userById = new Map<string, { email: string; name: string | null }>();
  for (const u of users) userById.set(u.id, { email: u.email, name: u.name });

  const tokens = rows.map((t) => {
    const owner = userById.get(t.userId);
    return {
      id: t.id,
      name: t.name,
      ownerId: t.userId,
      ownerLabel: owner?.name?.trim() || owner?.email || "unknown",
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
    };
  });

  return NextResponse.json({ tokens });
}
