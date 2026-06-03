// Sanitize a post-auth `next` redirect target. Only same-origin *relative*
// paths are allowed, so `?next=https://attacker.example` (or a protocol-
// relative `//attacker.example`) can't bounce an authenticated user off-site
// after login / password change (CWE-601, open redirect).
//
// Safe = starts with a single "/", and is not "//" (protocol-relative) or
// "/\" (some browsers normalize backslashes to "/"). Everything else → "/".
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (next[0] !== "/") return "/"; // absolute URL or relative-without-leading-slash
  if (next.startsWith("//") || next.startsWith("/\\")) return "/"; // //host or /\host
  return next;
}
