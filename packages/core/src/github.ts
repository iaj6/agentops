// ─── GitHub integration types ───────────────────────────────────────────────

export interface GitHubPR {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
}

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: "open" | "closed";
  readonly labels: ReadonlyArray<string>;
}

export interface GitHubCheck {
  readonly name: string;
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out"
    | "action_required"
    | "skipped"
    | null;
  readonly url: string;
}

export type GitHubLink =
  | { readonly type: "pr"; readonly data: GitHubPR }
  | { readonly type: "issue"; readonly data: GitHubIssue }
  | { readonly type: "check"; readonly data: GitHubCheck };

export interface GitHubInfo {
  readonly pr?: GitHubPR;
  readonly issue?: GitHubIssue;
  readonly checks?: ReadonlyArray<GitHubCheck>;
}
