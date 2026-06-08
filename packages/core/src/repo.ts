/**
 * Canonical repository identity for attribution + analytics bucketing.
 *
 * One git repo can otherwise surface under several different strings — a remote
 * URL (SSH `git@host:owner/repo.git` or HTTPS `https://host/owner/repo.git`,
 * with or without the `.git` suffix), a bare `owner/repo` slug, or a directory
 * basename — and because GitHub slugs are case-insensitive but case-preserving,
 * `Acme/Repo` and `acme/repo` would otherwise fragment into separate buckets.
 *
 * `normalizeRepo` collapses all of these to a single canonical key: lowercase
 * `owner/name` when an owner is present, else the lowercased final path segment
 * (the basename / `"unknown"` fallback case, which has no owner to recover).
 *
 * Strictly idempotent: `normalizeRepo(normalizeRepo(x)) === normalizeRepo(x)`.
 * This must stay in lockstep with the `cleanup --remap-repo` backfill target
 * (lowercase `owner/name`) so write-time values agree with backfilled history.
 */
export function normalizeRepo(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return s;

  // Peel a transport prefix if a full remote URL leaked through, leaving just
  // the path portion (owner/repo, possibly with a trailing .git):
  //   git@github.com:Owner/Repo.git   -> Owner/Repo.git   (scp-style SSH)
  //   https://github.com/Owner/Repo   -> /Owner/Repo      (URL)
  const scp = s.match(/^[^@/]+@[^:/]+:(.+)$/);
  if (scp) {
    s = scp[1]!;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      // Not a parseable URL — fall through with the original string.
    }
  }

  // Drop surrounding slashes and a single trailing .git, then take the first
  // two path segments as owner/name (a deeper URL path like /owner/repo/tree/x
  // collapses to owner/repo). One segment (basename / "unknown") is kept as-is.
  s = s.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length >= 2) {
    s = `${parts[0]}/${parts[1]}`;
  } else if (parts.length === 1) {
    s = parts[0]!;
  }

  return s.toLowerCase();
}
