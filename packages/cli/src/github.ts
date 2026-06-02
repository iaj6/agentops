import { execFileSync } from "node:child_process";
import type { GitHubPR, GitHubIssue, GitHubCheck } from "@agentops/core";

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// Run `gh` with an argv array — NEVER a shell string. Passing arguments as a
// vector means values like PR bodies, branch names, and titles can contain
// shell metacharacters ($(), backticks, quotes, newlines) without any risk of
// command injection: there is no shell to interpret them. Bodies/payloads that
// could be large or contain anything are fed via stdin (`input`), paired with
// gh's `--body-file -` / `--input -` flags, so they never touch argv at all.
function gh(args: readonly string[], input?: string): string {
  try {
    return execFileSync("gh", args as string[], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(input !== undefined ? { input } : {}),
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Look up the PR associated with the given branch (defaults to current branch).
 * Returns null if gh CLI is unavailable or no PR exists.
 */
export function getLinkedPR(branch?: string): GitHubPR | null {
  if (!ghAvailable()) return null;

  const args = ["pr", "list", "--state", "all"];
  if (branch) args.push("--head", branch);
  args.push(
    "--json",
    "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles",
    "--limit",
    "1",
  );
  const raw = gh(args);
  if (!raw) return null;

  let items: unknown[];
  try {
    items = JSON.parse(raw) as unknown[];
  } catch {
    return null;
  }

  if (items.length === 0) return null;
  const pr = items[0] as Record<string, unknown>;

  return {
    number: pr["number"] as number,
    title: pr["title"] as string,
    url: pr["url"] as string,
    state: mapPRState(pr["state"] as string),
    headBranch: pr["headRefName"] as string,
    baseBranch: pr["baseRefName"] as string,
    additions: (pr["additions"] as number) ?? 0,
    deletions: (pr["deletions"] as number) ?? 0,
    changedFiles: (pr["changedFiles"] as number) ?? 0,
  };
}

function mapPRState(state: string): "open" | "closed" | "merged" {
  switch (state.toUpperCase()) {
    case "OPEN":
      return "open";
    case "MERGED":
      return "merged";
    default:
      return "closed";
  }
}

/**
 * Fetch details for a GitHub issue by number.
 * Returns null if gh CLI is unavailable or the issue doesn't exist.
 */
export function getIssue(issueNumber: number): GitHubIssue | null {
  if (!ghAvailable()) return null;

  const raw = gh([
    "issue",
    "view",
    String(issueNumber),
    "--json",
    "number,title,url,state,labels",
  ]);
  if (!raw) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const labels = Array.isArray(data["labels"])
    ? (data["labels"] as Array<Record<string, unknown>>).map(
        (l) => (l["name"] as string) ?? "",
      )
    : [];

  return {
    number: data["number"] as number,
    title: data["title"] as string,
    url: data["url"] as string,
    state: (data["state"] as string)?.toLowerCase() === "open" ? "open" : "closed",
    labels,
  };
}

/**
 * Create a pull request. Returns the created PR or null if gh CLI is unavailable.
 */
export function createPR(
  title: string,
  body: string,
  base?: string,
): GitHubPR | null {
  if (!ghAvailable()) return null;

  // Title is passed as a single argv element (no shell interpretation); the
  // body is piped via stdin with `--body-file -` so it can contain anything.
  const args = ["pr", "create", "--title", title, "--body-file", "-"];
  if (base) args.push("--base", base);
  args.push(
    "--json",
    "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles",
  );
  const raw = gh(args, body);
  if (!raw) return null;

  // gh pr create might not return JSON; fall back to fetching the PR
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // gh pr create outputs the PR URL as plain text on success
    // Try to look up the PR we just created
    const pr = getLinkedPR();
    return pr;
  }

  return {
    number: data["number"] as number,
    title: data["title"] as string,
    url: data["url"] as string,
    state: mapPRState((data["state"] as string) ?? "OPEN"),
    headBranch: (data["headRefName"] as string) ?? "",
    baseBranch: (data["baseRefName"] as string) ?? "",
    additions: (data["additions"] as number) ?? 0,
    deletions: (data["deletions"] as number) ?? 0,
    changedFiles: (data["changedFiles"] as number) ?? 0,
  };
}

/**
 * Add a comment to a pull request.
 * Returns true on success, false if gh CLI is unavailable or the command fails.
 */
export function addPRComment(prNumber: number, body: string): boolean {
  if (!ghAvailable()) return false;

  // Comment body is piped via stdin (`--body-file -`); it commonly embeds
  // agent-recorded data (file paths, command strings, policy messages) that
  // must never be evaluated by a shell.
  const result = gh(
    ["pr", "comment", String(prNumber), "--body-file", "-"],
    body,
  );
  return result !== "";
}

/**
 * Create a commit status / check run.
 * Returns the check info or null if gh CLI is unavailable.
 */
export function createCheckRun(
  name: string,
  status: GitHubCheck["status"],
  conclusion: GitHubCheck["conclusion"],
  detailsUrl?: string,
): GitHubCheck | null {
  if (!ghAvailable()) return null;

  // gh doesn't have a direct check-run create, use the API
  const headSha = getHeadSha();
  if (!headSha) return null;

  // Build the payload as a real object and serialize with JSON.stringify, then
  // pipe it via stdin (`--input -`). No string interpolation, no heredoc, no
  // shell — so name/conclusion/detailsUrl can't break out.
  const payload: Record<string, unknown> = {
    name,
    head_sha: headSha,
    status,
  };
  if (conclusion) payload.conclusion = conclusion;
  if (detailsUrl) payload.details_url = detailsUrl;

  gh(
    ["api", "repos/{owner}/{repo}/check-runs", "--method", "POST", "--input", "-"],
    JSON.stringify(payload),
  );

  // Even if the API call fails, return the intended check object
  return {
    name,
    status,
    conclusion,
    url: detailsUrl ?? "",
  };
}

function getHeadSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Check whether the GitHub CLI (gh) is installed and available.
 */
export function isGhAvailable(): boolean {
  return ghAvailable();
}
