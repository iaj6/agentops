import { Command } from "commander";
import {
  JobStatus,
  JobPriority,
  createJobId,
  createJob,
  cancelJob,
  retryJob,
} from "@agentops/core";
import type { Job } from "@agentops/core";
import { getDb, insertJob, getJob, listJobs, updateJob, getQueuedJobs } from "@agentops/db";
import { table, colorStatus } from "../format.js";

export function registerJobCommands(program: Command): void {
  const job = program.command("job").description("Manage agent jobs");

  job
    .command("submit")
    .description("Submit a new job to the queue")
    .argument("<goal>", "The goal for this job")
    .option("--repo <repo>", "Repository name", "unknown")
    .option("--branch <branch>", "Branch name", "main")
    .option("--priority <priority>", "Job priority (critical, high, normal, low)", "normal")
    .action((goal: string, opts: { repo: string; branch: string; priority: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const priority = (Object.values(JobPriority).includes(opts.priority as JobPriority)
        ? opts.priority
        : JobPriority.Normal) as JobPriority;

      const newJob = createJob(
        {
          humanReadable: goal,
          structured: { type: "task", description: goal, parameters: {} },
        },
        {
          repo: opts.repo,
          branch: opts.branch,
          permissions: [],
          sandbox: { enabled: false, isolationLevel: "none" },
        },
        { priority },
      );
      insertJob(db, newJob);

      if (json) {
        console.log(JSON.stringify({ id: newJob.id, status: newJob.status, priority: newJob.priority }));
      } else {
        console.log(`Job submitted: ${newJob.id} (priority: ${newJob.priority})`);
      }
    });

  job
    .command("status")
    .description("Show job status and details")
    .argument("<jobId>", "The job ID")
    .action((jobId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const j = getJob(db, createJobId(jobId));

      if (!j) {
        console.error(`Job not found: ${jobId}`);
        process.exit(1);
      }

      if (json) {
        console.log(JSON.stringify(j, null, 2));
        return;
      }

      console.log(`Job:       ${j.id}`);
      console.log(`Status:    ${colorStatus(j.status)}`);
      console.log(`Priority:  ${j.priority}`);
      console.log(`Goal:      ${j.goal.humanReadable}`);
      console.log(`Repo:      ${j.environment.repo}`);
      console.log(`Branch:    ${j.environment.branch}`);
      console.log(`Attempt:   ${j.attempt}/${j.maxAttempts}`);
      console.log(`Session:   ${j.sessionId ?? "none"}`);
      console.log(`Runs:      ${j.runIds.length > 0 ? (j.runIds as unknown as string[]).join(", ") : "none"}`);
      console.log(`Queued:    ${j.queuedAt}`);
      if (j.dispatchedAt) console.log(`Dispatched: ${j.dispatchedAt}`);
      if (j.completedAt) console.log(`Completed:  ${j.completedAt}`);
      console.log(`Created:   ${j.createdAt}`);
      console.log(`Updated:   ${j.updatedAt}`);
    });

  job
    .command("list")
    .description("List recent jobs")
    .option("--status <status>", "Filter by status")
    .option("--repo <repo>", "Filter by repo")
    .option("--limit <n>", "Max results", "20")
    .action((opts: { status?: string; repo?: string; limit: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = listJobs(db, {
        status: opts.status,
        repo: opts.repo,
        limit: parseInt(opts.limit, 10),
      });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No jobs found.");
        return;
      }

      const rows = results.map((j) => [
        j.id as string,
        colorStatus(j.status),
        j.priority,
        j.environment.repo,
        j.queuedAt,
      ]);

      console.log(table(["ID", "Status", "Priority", "Repo", "Queued"], rows));
    });

  job
    .command("cancel")
    .description("Cancel a job")
    .argument("<jobId>", "The job ID")
    .action((jobId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const j = getJob(db, createJobId(jobId));

      if (!j) {
        console.error(`Job not found: ${jobId}`);
        process.exit(1);
      }

      const cancelled = cancelJob(j);
      updateJob(db, cancelled.id, {
        status: cancelled.status,
        updatedAt: cancelled.updatedAt,
      });

      if (json) {
        console.log(JSON.stringify({ id: cancelled.id, status: cancelled.status }));
      } else {
        console.log(`Job ${jobId} cancelled.`);
      }
    });

  job
    .command("retry")
    .description("Retry a failed job")
    .argument("<jobId>", "The job ID")
    .action((jobId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const j = getJob(db, createJobId(jobId));

      if (!j) {
        console.error(`Job not found: ${jobId}`);
        process.exit(1);
      }

      const retried = retryJob(j);
      updateJob(db, retried.id, {
        status: retried.status,
        attempt: retried.attempt,
        sessionId: retried.sessionId,
        dispatchedAt: retried.dispatchedAt,
        updatedAt: retried.updatedAt,
      });

      if (json) {
        console.log(JSON.stringify({ id: retried.id, status: retried.status, attempt: retried.attempt }));
      } else {
        if (retried.status === JobStatus.Failed) {
          console.log(`Job ${jobId} has exceeded max attempts (${retried.maxAttempts}).`);
        } else {
          console.log(`Job ${jobId} retried (attempt ${retried.attempt}/${retried.maxAttempts}).`);
        }
      }
    });

  job
    .command("queue")
    .description("Show current job queue")
    .option("--limit <n>", "Max results", "20")
    .action((opts: { limit: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const queued = getQueuedJobs(db, parseInt(opts.limit, 10));

      if (json) {
        console.log(JSON.stringify(queued, null, 2));
        return;
      }

      if (queued.length === 0) {
        console.log("Queue is empty.");
        return;
      }

      const rows = queued.map((j) => [
        j.id as string,
        j.priority,
        j.environment.repo,
        `${j.attempt}/${j.maxAttempts}`,
        j.queuedAt,
      ]);

      console.log(table(["ID", "Priority", "Repo", "Attempt", "Queued"], rows));
    });
}
