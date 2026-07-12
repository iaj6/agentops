import { execSync } from "node:child_process";
import { normalizeRepo } from "@agentops/core";

function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function parseRemote(remote: string): string {
  // Handle SSH: git@github.com:owner/repo.git
  const sshMatch = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1]!;
  // Handle HTTPS: https://github.com/owner/repo.git
  try {
    const url = new URL(remote);
    return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return remote;
  }
}

export function getCurrentRepo(cwd?: string): string {
  // Try the common remote names in order — many repos use upstream,
  // some use github, some have neither. Normalize to a canonical
  // lowercase owner/name so the same repo never fragments into multiple
  // analytics buckets (e.g. Acme/Repo vs acme/repo).
  for (const name of ["origin", "upstream", "github"]) {
    const remote = git(`remote get-url ${name}`, cwd);
    if (remote) return normalizeRepo(parseRemote(remote));
  }
  // Fall back to the basename of the repo root. Better than "unknown"
  // for local-only repos (the agentops dogfood case) — at least the
  // dashboard rows are distinguishable. Normalized (lowercased) too so a
  // later remote-backed run with the same name agrees on case.
  const top = git("rev-parse --show-toplevel", cwd);
  if (top) {
    const basename = top.split("/").filter(Boolean).pop();
    if (basename) return normalizeRepo(basename);
  }
  return "unknown";
}

export function getCurrentBranch(cwd?: string): string {
  return git("rev-parse --abbrev-ref HEAD", cwd) || "unknown";
}

export interface ChangedFile {
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  path: string;
}

export function getChangedFiles(cwd?: string): ChangedFile[] {
  const output = git("status --porcelain", cwd);
  if (!output) return [];

  return output.split("\n").filter(Boolean).map((line) => {
    const code = line.slice(0, 2).trim();
    const path = line.slice(3);
    let status: ChangedFile["status"];
    switch (code) {
      case "A":
      case "??":
        status = "added";
        break;
      case "M":
      case "MM":
      case "AM":
        status = "modified";
        break;
      case "D":
        status = "deleted";
        break;
      case "R":
        status = "renamed";
        break;
      default:
        status = "modified";
    }
    return { status, path };
  });
}

/**
 * Get the diff of all changes in the working tree (staged + unstaged).
 */
export function getWorkingTreeDiff(cwd?: string): string {
  // Include both staged and unstaged
  return git("diff HEAD", cwd);
}
