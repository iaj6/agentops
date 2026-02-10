import { Command } from "commander";
import { createRunId } from "@agentops/core";
import type { GitHubInfo } from "@agentops/core";
import { getDb, getRun, updateRun } from "@agentops/db";
import { getLinkedPR, getIssue, isGhAvailable } from "../github.js";
import { getCurrentBranch } from "../git.js";

export function registerLinkCommands(program: Command): void {
  const link = program
    .command("link")
    .description("Link GitHub resources to a run");

  link
    .command("pr")
    .description("Link the current branch's PR to a run")
    .argument("<runId>", "The run ID to link")
    .option("--branch <branch>", "Branch to look up (defaults to current)")
    .action((runId: string, opts: { branch?: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      if (!isGhAvailable()) {
        console.error("GitHub CLI (gh) is not installed. Install it from https://cli.github.com");
        process.exit(1);
      }

      const run = getRun(db, createRunId(runId));
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const branch = opts.branch ?? getCurrentBranch();
      const pr = getLinkedPR(branch);
      if (!pr) {
        console.error(`No PR found for branch: ${branch}`);
        process.exit(1);
      }

      const github: GitHubInfo = {
        ...run.github,
        pr,
      };

      updateRun(db, run.id, {
        github,
        updatedAt: new Date().toISOString(),
      } as Partial<typeof run>);

      if (json) {
        console.log(JSON.stringify({ runId, pr }));
      } else {
        console.log(`Linked PR #${pr.number} (${pr.title}) to run ${runId}`);
      }
    });

  link
    .command("issue")
    .description("Link a GitHub issue to a run")
    .argument("<runId>", "The run ID to link")
    .argument("<issueNumber>", "The issue number")
    .action((runId: string, issueNumber: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      if (!isGhAvailable()) {
        console.error("GitHub CLI (gh) is not installed. Install it from https://cli.github.com");
        process.exit(1);
      }

      const run = getRun(db, createRunId(runId));
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const issue = getIssue(parseInt(issueNumber, 10));
      if (!issue) {
        console.error(`Issue not found: #${issueNumber}`);
        process.exit(1);
      }

      const github: GitHubInfo = {
        ...run.github,
        issue,
      };

      updateRun(db, run.id, {
        github,
        updatedAt: new Date().toISOString(),
      } as Partial<typeof run>);

      if (json) {
        console.log(JSON.stringify({ runId, issue }));
      } else {
        console.log(`Linked issue #${issue.number} (${issue.title}) to run ${runId}`);
      }
    });
}
