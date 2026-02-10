import type { Job, RunId, SessionId } from "./types.js";
import { JobStatus, JobPriority, createJobId } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

let counter = 0;
function generateId(): string {
  counter++;
  return `job_${Date.now()}_${counter}`;
}

export interface CreateJobOptions {
  priority?: JobPriority;
  maxAttempts?: number;
  retryPolicy?: Job["retryPolicy"];
  concurrencyLimits?: Job["concurrencyLimits"];
}

export function createJob(
  goal: Job["goal"],
  environment: Job["environment"],
  options?: CreateJobOptions,
): Job {
  const timestamp = now();
  return {
    id: createJobId(generateId()),
    status: JobStatus.Queued,
    priority: options?.priority ?? JobPriority.Normal,
    goal,
    environment,
    retryPolicy: options?.retryPolicy ?? {
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
    },
    concurrencyLimits: options?.concurrencyLimits ?? {
      perRepo: 5,
      perOrg: 10,
      global: 50,
    },
    runIds: [],
    sessionId: null,
    attempt: 0,
    maxAttempts: options?.maxAttempts ?? 3,
    queuedAt: timestamp,
    dispatchedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function dispatchJob(job: Job, sessionId: SessionId): Job {
  return {
    ...job,
    status: JobStatus.Dispatched,
    sessionId,
    dispatchedAt: now(),
    updatedAt: now(),
  };
}

export function startJobRun(job: Job, runId: RunId): Job {
  return {
    ...job,
    status: JobStatus.Running,
    runIds: [...job.runIds, runId],
    updatedAt: now(),
  };
}

export function completeJob(job: Job): Job {
  return {
    ...job,
    status: JobStatus.Completed,
    completedAt: now(),
    updatedAt: now(),
  };
}

export function failJob(job: Job, _reason: string): Job {
  return {
    ...job,
    status: JobStatus.Failed,
    updatedAt: now(),
  };
}

export function cancelJob(job: Job): Job {
  return {
    ...job,
    status: JobStatus.Cancelled,
    updatedAt: now(),
  };
}

export function retryJob(job: Job): Job {
  if (job.attempt >= job.maxAttempts) {
    return {
      ...job,
      status: JobStatus.Failed,
      updatedAt: now(),
    };
  }
  return {
    ...job,
    status: JobStatus.Queued,
    attempt: job.attempt + 1,
    sessionId: null,
    dispatchedAt: null,
    updatedAt: now(),
  };
}
