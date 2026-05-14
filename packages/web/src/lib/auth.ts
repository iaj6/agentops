import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  getUserBySessionId,
  getUserByRawApiToken,
  getRun,
  getSession,
  type User,
} from "@agentops/db";
import {
  createRunId,
  createSessionId,
  type Run,
  type Session,
} from "@agentops/core";
import { db } from "./db";
import { SESSION_COOKIE_NAME } from "./auth-constants";

export { SESSION_COOKIE_NAME };

// ─── Auth resolution (unified bearer / cookie) ─────────────────────────────
//
// Order of precedence:
//   1. Authorization: Bearer <token>  — used by CLI / SDK / hook subprocess
//   2. Cookie session                 — used by the browser
//
// Returns the resolved User or null. Callers decide whether to 401 or
// redirect.

export async function getRequestUser(req?: NextRequest): Promise<User | null> {
  const authHeader = req
    ? req.headers.get("authorization")
    : null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const raw = authHeader.slice("Bearer ".length).trim();
    if (raw.length > 0) {
      const user = getUserByRawApiToken(db(), raw);
      if (user) return user;
    }
  }

  // Fall through to cookie. next/headers.cookies() works in both route
  // handlers and server components.
  let cookieStore;
  try {
    cookieStore = await cookies();
  } catch {
    return null;
  }
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;
  return getUserBySessionId(db(), sessionId);
}

// ─── Helpers for API routes ────────────────────────────────────────────────

export function unauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Resolve the request user or short-circuit with 401. Standard one-liner
 * for API route handlers:
 *
 *   const u = await requireUser(req); if (u instanceof NextResponse) return u;
 */
export async function requireUser(
  req: NextRequest,
): Promise<User | NextResponse> {
  const user = await getRequestUser(req);
  if (!user) return unauthorized();
  return user;
}

/**
 * Like requireUser but additionally requires Bearer auth (rejects cookie
 * sessions). Use on SDK routes where we never want a browser cookie to
 * be a credential.
 */
export async function requireBearerUser(
  req: NextRequest,
): Promise<User | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized("Bearer token required");
  }
  const raw = authHeader.slice("Bearer ".length).trim();
  if (raw.length === 0) return unauthorized("Bearer token required");
  const user = getUserByRawApiToken(db(), raw);
  if (!user) return unauthorized("Invalid or expired token");
  return user;
}

export async function requireAdmin(
  req: NextRequest,
): Promise<User | NextResponse> {
  const result = await requireUser(req);
  if (result instanceof NextResponse) return result;
  if (result.role !== "admin") return forbidden("Admin role required");
  return result;
}

/**
 * Resolve the run by id, require Bearer auth, and verify the caller owns
 * the run. Admin role bypasses the ownership check. Runs with userId=null
 * are pre-auth / local-dev rows; only admins may touch them via the SDK.
 */
export async function requireOwnedRun(
  req: NextRequest,
  runId: string,
): Promise<{ user: User; run: Run } | NextResponse> {
  const user = await requireBearerUser(req);
  if (user instanceof NextResponse) return user;
  const run = getRun(db(), createRunId(runId));
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (user.role === "admin") return { user, run };
  if (run.userId === user.id) return { user, run };
  return forbidden("You do not own this run");
}

export async function requireOwnedSession(
  req: NextRequest,
  sessionId: string,
): Promise<{ user: User; session: Session } | NextResponse> {
  const user = await requireBearerUser(req);
  if (user instanceof NextResponse) return user;
  const session = getSession(db(), createSessionId(sessionId));
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (user.role === "admin") return { user, session };
  if (session.userId === user.id) return { user, session };
  return forbidden("You do not own this session");
}
