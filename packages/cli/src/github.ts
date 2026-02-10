import { execSync } from "node:child_process";
import type { GitHubPR, GitHubIssue, GitHubCheck } from "@agentops/core";

function ghAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function gh(args: string): string {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
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

  const branchArg = branch ? ` --head "${branch}"` : "";
  const raw = gh(
    `pr list --state all${branchArg} --json number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles --limit 1`,
  );
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

  const raw = gh(
    `issue view ${issueNumber} --json number,title,url,state,labels`,
  );
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

  const baseArg = base ? ` --base "${base}"` : "";
  // Create the PR and capture JSON output
  const raw = gh(
    `pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"${baseArg} --json number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles`,
  );
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

  const result = gh(
    `pr comment ${prNumber} --body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
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
  const conclusionArg = conclusion ? `,"conclusion":"${conclusion}"` : "";
  const urlArg = detailsUrl
    ? `,"details_url":"${detailsUrl}"`
    : "";
  const headSha = getHeadSha();
  if (!headSha) return null;

  const payload = `{"name":"${name}","head_sha":"${headSha}","status":"${status}"${conclusionArg}${urlArg}}`;
  const raw = gh(
    `api repos/{owner}/{repo}/check-runs --method POST --input - <<< '${payload}'`,
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
    return execSync("git rev-parse HEAD", {
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
