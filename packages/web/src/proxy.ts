import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth-constants";

// Proxy (the Next 16 successor to middleware) does NOT validate the session
// — it only checks whether a credential is present (cookie or bearer
// header). Actual user lookup happens in route handlers / server components
// where the DB is reachable. This keeps the proxy cheap and runtime-agnostic.
//
// Two responsibilities beyond the credential gate:
//   1. Generate (or accept) an x-request-id and propagate it to handlers
//      via a request header + back to the client via a response header.
//      This lets a customer paste an ID from a failed response into the
//      operator's chat and have it grepped out of the dashboard logs.
//   2. Emit one structured log line per request with method, path, and
//      requestId. Logger lives in lib/log.ts and is edge-runtime safe.

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  // Device authorization grant: the token-poll endpoint is public (the
  // device_code itself is the credential) and the user-facing approval
  // page handles its own auth redirect.
  "/api/auth/device",
  "/api/auth/device/token",
]);

const PUBLIC_PREFIXES = [
  "/_next/",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// Accept inbound x-request-id (lets a customer's reverse proxy keep its
// own trace IDs) but fall back to a fresh UUID. crypto.randomUUID() is
// available in both Node and Edge runtimes via Web Crypto.
function requestId(req: NextRequest): string {
  const inbound = req.headers.get("x-request-id");
  if (inbound && /^[A-Za-z0-9._-]{1,64}$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

function logRequest(req: NextRequest, rid: string, outcome: string, status?: number): void {
  // JSON-per-line to stdout. We can't import lib/log.ts here without
  // breaking Edge runtime in some Next versions, so inline the format.
  // Keep this shape aligned with lib/log.ts so log aggregators see
  // consistent fields.
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: "info",
    msg: "request",
    requestId: rid,
    method: req.method,
    path: req.nextUrl.pathname,
    outcome,
  };
  if (status !== undefined) entry.status = status;
  console.log(JSON.stringify(entry));
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const rid = requestId(req);

  // Make the id reachable to downstream handlers via a request header.
  // Next.js requires passing modified request headers via NextResponse.next.
  const downstreamHeaders = new Headers(req.headers);
  downstreamHeaders.set("x-request-id", rid);

  const passThrough = () => {
    const res = NextResponse.next({ request: { headers: downstreamHeaders } });
    res.headers.set("x-request-id", rid);
    return res;
  };

  if (isPublic(pathname)) {
    logRequest(req, rid, "public");
    return passThrough();
  }

  const hasSessionCookie = !!req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasBearer =
    req.headers.get("authorization")?.startsWith("Bearer ") ?? false;

  if (hasSessionCookie || hasBearer) {
    logRequest(req, rid, "auth_ok");
    return passThrough();
  }

  // No credential. API routes get a 401; SSR pages get redirected to /login
  // with a `next` parameter so we can bounce back after login.
  if (isApiPath(pathname)) {
    logRequest(req, rid, "unauthenticated", 401);
    const res = NextResponse.json(
      { error: "Unauthorized", requestId: rid },
      { status: 401 },
    );
    res.headers.set("x-request-id", rid);
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  logRequest(req, rid, "redirect_login");
  const res = NextResponse.redirect(url);
  res.headers.set("x-request-id", rid);
  return res;
}

export const config = {
  // Run on every path except Next.js internals and static files. The
  // function itself handles fine-grained public-vs-protected logic.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.svg|favicon\\.ico).*)",
  ],
};
