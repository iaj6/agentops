import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth-constants";

// Proxy (the Next 16 successor to middleware) does NOT validate the session
// — it only checks whether a credential is present (cookie or bearer
// header). Actual user lookup happens in route handlers / server components
// where the DB is reachable. This keeps the proxy cheap and runtime-agnostic.

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

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = !!req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasBearer =
    req.headers.get("authorization")?.startsWith("Bearer ") ?? false;

  if (hasSessionCookie || hasBearer) {
    return NextResponse.next();
  }

  // No credential. API routes get a 401; SSR pages get redirected to /login
  // with a `next` parameter so we can bounce back after login.
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every path except Next.js internals and static files. The
  // function itself handles fine-grained public-vs-protected logic.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.svg|favicon\\.ico).*)",
  ],
};
