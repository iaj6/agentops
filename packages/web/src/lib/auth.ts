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
  // Prefer bearer header when a NextRequest is supplied (route handlers).
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

  // Cookie path: read directly from the NextRequest when we have one
  // (works in route handlers AND tests). Fall back to next/headers
  // cookies() for server components, which don't receive a request.
  let sessionId: string | undefined;
  if (req) {
    sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  } else {
    try {
      const cookieStore = await cookies();
      sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      return null;
    }
  }
  if (!sessionId) return null;
  return getUserBySessionId(db(), sessionId);
}

// ─── Helpers for API routes ────────────────────────────────────────────────

// Pull the proxy-supplied request id off the request (if any) so error
// responses surface it. Customer pastes the id into chat → operator greps
// dashboard logs for it → real diagnosis path.
function ridFromHeaders(req?: NextRequest): string | undefined {
  if (!req) return undefined;
  return req.headers.get("x-request-id") ?? undefined;
}

export function unauthorized(message = "Unauthorized", req?: NextRequest): NextResponse {
  const requestId = ridFromHeaders(req);
  return NextResponse.json(
    requestId ? { error: message, requestId } : { error: message },
    { status: 401 },
  );
}

export function forbidden(message = "Forbidden", req?: NextRequest): NextResponse {
  const requestId = ridFromHeaders(req);
  return NextResponse.json(
    requestId ? { error: message, requestId } : { error: message },
    { status: 403 },
  );
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
  if (!user) return unauthorized("Unauthorized", req);
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
    return unauthorized("Bearer token required", req);
  }
  const raw = authHeader.slice("Bearer ".length).trim();
  if (raw.length === 0) return unauthorized("Bearer token required", req);
  const user = getUserByRawApiToken(db(), raw);
  if (!user) return unauthorized("Invalid or expired token", req);
  return user;
}

export async function requireAdmin(
  req: NextRequest,
): Promise<User | NextResponse> {
  const result = await requireUser(req);
  if (result instanceof NextResponse) return result;
  if (result.role !== "admin") return forbidden("Admin role required", req);
  return result;
}

/**
 * Resolve the run by id, require Bearer auth, and verify the caller owns
 * the run. Admin role bypasses the ownership check. Runs with userId=null
 * are pre-auth / local-dev rows; only admins may touch them via the SDK.
 */
function notFound(name: string, req: NextRequest): NextResponse {
  const requestId = ridFromHeaders(req);
  return NextResponse.json(
    requestId ? { error: `${name} not found`, requestId } : { error: `${name} not found` },
    { status: 404 },
  );
}

export async function requireOwnedRun(
  req: NextRequest,
  runId: string,
): Promise<{ user: User; run: Run } | NextResponse> {
  const user = await requireBearerUser(req);
  if (user instanceof NextResponse) return user;
  const run = getRun(db(), createRunId(runId));
  if (!run) return notFound("Run", req);
  if (user.role === "admin") return { user, run };
  if (run.userId === user.id) return { user, run };
  // 404 (not 403) on non-owner — don't leak which run IDs exist by giving
  // a different status code for "exists but not yours" vs "doesn't exist."
  return notFound("Run", req);
}

export async function requireOwnedSession(
  req: NextRequest,
  sessionId: string,
): Promise<{ user: User; session: Session } | NextResponse> {
  const user = await requireBearerUser(req);
  if (user instanceof NextResponse) return user;
  const session = getSession(db(), createSessionId(sessionId));
  if (!session) return notFound("Session", req);
  if (user.role === "admin") return { user, session };
  if (session.userId === user.id) return { user, session };
  // 404 not 403 — same enumeration-defense rationale as requireOwnedRun.
  return notFound("Session", req);
}

// ─── View scoping for SSR pages ────────────────────────────────────────────
//
// Members are always scoped to their own runs/sessions. Admins default to
// the team view (no filter) but can opt into "my runs" via ?view=mine.
// Returns a filter object suitable for listRuns/listSessions.

export interface ViewScope {
  readonly userId?: string;
  /** What's actually being shown — used by the sidebar toggle and page chrome. */
  readonly active: "mine" | "team" | "user";
  /** Whether the user has any choice in the matter (admins do, members don't). */
  readonly canToggle: boolean;
}

export function resolveViewScope(
  user: User,
  searchParams: { view?: string; userId?: string } | URLSearchParams,
): ViewScope {
  const get = (key: string): string | null =>
    searchParams instanceof URLSearchParams
      ? searchParams.get(key)
      : ((searchParams as Record<string, string | undefined>)[key] ?? null);
  const viewParam = get("view");
  const userIdParam = get("userId");

  if (user.role !== "admin") {
    // Members never see anyone else's data, regardless of query param.
    return { userId: user.id, active: "mine", canToggle: false };
  }

  // Admin: explicit ?userId=<id> wins; falls back to ?view=mine, then
  // team-wide. ?userId=<own-id> normalizes to "mine" so the sidebar UI
  // and page chrome agree.
  if (userIdParam) {
    if (userIdParam === user.id) {
      return { userId: user.id, active: "mine", canToggle: true };
    }
    return { userId: userIdParam, active: "user", canToggle: true };
  }
  if (viewParam === "mine") {
    return { userId: user.id, active: "mine", canToggle: true };
  }
  return { active: "team", canToggle: true };
}
