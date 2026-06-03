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
    // Mark Secure in production (the dashboard is served over HTTPS there,
    // typically behind a TLS-terminating reverse proxy that forwards plain
    // HTTP to Next — so req.url alone reads "http://" and would wrongly drop
    // the flag). Honor x-forwarded-proto as well, and keep the req.url check
    // for any direct-HTTPS setup. Dev over http://localhost stays non-Secure.
    secure:
      process.env.NODE_ENV === "production" ||
      req.headers.get("x-forwarded-proto") === "https" ||
      req.url.startsWith("https://"),
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return res;
}
