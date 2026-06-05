import { NextResponse, type NextRequest } from "next/server";
import {
  getUserWithPasswordByEmail,
  verifyPassword,
  createAuthSession,
} from "@agentops/db";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME, checkSameOrigin } from "@/lib/auth";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { clientIp, loginAccountLimiter, loginIpLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(req: NextRequest) {
  // Reject cross-origin sign-ins before doing any work (defense-in-depth on
  // top of SameSite=Lax) — also blocks login-CSRF that would pin the victim
  // to an attacker-chosen session.
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
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

  // Rate-limit failed sign-ins. Key by (ip + email) so a brute-force against
  // one account is blocked without locking the victim out globally, plus a
  // looser per-IP cap to bound credential stuffing. Check before verifying so
  // a locked-out caller never reaches the (deliberately expensive) scrypt hash.
  const ip = clientIp(req);
  const acctKey = `${ip}|${body.email.toLowerCase()}`;
  const limited = [
    loginAccountLimiter.status(acctKey),
    loginIpLimiter.status(ip),
  ].find((s) => s.limited);
  if (limited) {
    return NextResponse.json(
      { error: "Too many failed sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }
  const recordFailure = (): void => {
    loginAccountLimiter.recordFailure(acctKey);
    loginIpLimiter.recordFailure(ip);
  };

  // Generic 401 for both unknown user and wrong password — don't leak
  // which accounts exist.
  const found = getUserWithPasswordByEmail(db(), body.email);
  if (!found) {
    recordFailure();
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!verifyPassword(body.password, found.passwordHash)) {
    recordFailure();
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Successful auth clears the failure counters for this account + IP.
  loginAccountLimiter.reset(acctKey);
  loginIpLimiter.reset(ip);

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
