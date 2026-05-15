import { NextResponse, type NextRequest } from "next/server";
import {
  getUserWithPasswordByEmail,
  verifyPassword,
  createAuthSession,
} from "@agentops/db";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: NextRequest) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { error: "email and password required" },
      { status: 400 },
    );
  }

  // Generic 401 for both unknown user and wrong password — don't leak
  // which accounts exist.
  const found = getUserWithPasswordByEmail(db(), body.email);
  if (!found) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!verifyPassword(body.password, found.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const session = createAuthSession(db(), found.user.id);
  recordAudit(req, found.user.id, AUDIT_ACTIONS.USER_LOGIN, {
    targetType: "user",
    targetId: found.user.id,
  });
  const res = NextResponse.json({
    user: {
      id: found.user.id,
      email: found.user.email,
      name: found.user.name,
      role: found.user.role,
      mustChangePassword: found.user.mustChangePassword,
    },
  });
  res.cookies.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    // secure only when actually served over HTTPS. The dashboard self-host
    // commonly runs on http://localhost or behind a reverse proxy that
    // terminates TLS; let the proxy / deployment decide.
    secure: req.url.startsWith("https://"),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
