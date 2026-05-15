import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getUserByEmail, insertUser, listUsers } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

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
    createdAt: u.createdAt,
  }));
  return NextResponse.json({ users });
}

// Generate a non-ambiguous 16-char temp password. Same alphabet/length the
// CLI `agentops user add` uses so the two paths produce passwords that
// feel consistent.
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

// Invite a new user. Admin-only. Returns the one-time temp password in the
// response — the admin shares it out-of-band and the new user changes it
// on first sign-in (mustChangePassword=true).
export async function POST(request: NextRequest) {
  const me = await requireUser(request);
  if (me instanceof NextResponse) return me;
  if (me.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let body: { email?: unknown; name?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "email is required and must look like an email" },
      { status: 400 },
    );
  }
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const requestedRole = body.role === "admin" ? "admin" : "member";

  const existing = getUserByEmail(db(), email);
  if (existing) {
    return NextResponse.json(
      { error: "A user with that email already exists" },
      { status: 409 },
    );
  }

  const tempPassword = generateTempPassword();
  const created = insertUser(db(), {
    email,
    ...(name ? { name } : {}),
    password: tempPassword,
    role: requestedRole,
    mustChangePassword: true,
  });

  recordAudit(request, me.id, AUDIT_ACTIONS.USER_ADDED, {
    targetType: "user",
    targetId: created.id,
    metadata: { email: created.email, role: created.role, invitedByEmail: me.email },
  });

  return NextResponse.json(
    {
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
      },
      tempPassword,
    },
    { status: 201 },
  );
}
