import { Command } from "commander";
import { EventBus } from "@agentops/core";
import type { OrchestratorDb } from "@agentops/core";
import {
  dispatchNextJob,
  cleanupStaleSessions,
  cleanupExpiredLocks,
} from "@agentops/core";
import {
  getDb,
  getJob,
  getQueuedJobs,
  countJobsByRepo,
  countJobsActive,
  getSession,
  getActiveSessions,
  getStaleSessions,
  updateJob,
  updateSession,
  insertEvent,
  insertLock,
  updateLock,
  getActiveLocks,
  getActiveLocksForHolder,
  releaseLocksForHolder,
  releaseExpiredLocks,
} from "@agentops/db";
import type { AgentOpsDb } from "@agentops/db";

function wrapDb(db: AgentOpsDb): OrchestratorDb {
  return {
    insertJob: (job) => {
      // Not needed for dispatch/cleanup commands
      throw new Error("insertJob not expected in dispatch commands");
    },
    getJob: (id) => getJob(db, id),
    updateJob: (id, updates) => updateJob(db, id, updates),
    getQueuedJobs: (limit) => getQueuedJobs(db, limit),
    countJobsByRepo: (repo, statuses) => countJobsByRepo(db, repo, statuses),
    countJobsActive: () => countJobsActive(db),
    getSession: (id) => getSession(db, id),
    updateSession: (id, updates) => updateSession(db, id, updates),
    getActiveSessions: () => getActiveSessions(db),
    getStaleSessions: (thresholdIso) => getStaleSessions(db, thresholdIso),
    insertEvent: (event) => insertEvent(db, event),
    insertLock: (lock) => insertLock(db, lock),
    updateLock: (id, updates) => updateLock(db, id, updates),
    getActiveLocks: (resource) => getActiveLocks(db, resource),
    getActiveLocksForHolder: (holderId) => getActiveLocksForHolder(db, holderId),
    releaseLocksForHolder: (holderId) => releaseLocksForHolder(db, holderId),
    releaseExpiredLocks: () => releaseExpiredLocks(db),
  };
}

export function registerDispatchCommands(program: Command): void {
  const dispatch = program.command("dispatch").description("Dispatch and cleanup orchestration");

  dispatch
    .command("next")
    .description("Dispatch the next queued job to an available session")
    .action(() => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const odb = wrapDb(db);
      const eventBus = new EventBus();

      const result = dispatchNextJob(odb, eventBus);

      if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.dispatched) {
        console.log(`Dispatched job ${result.job!.id} to session ${result.session!.id}`);
      } else {
        console.log(`No dispatch: ${result.reason}`);
      }
    });

  dispatch
    .command("cleanup")
    .description("Clean up stale sessions and expired locks")
    .option("--threshold <ms>", "Heartbeat staleness threshold in ms", "60000")
    .action((opts: { threshold: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const odb = wrapDb(db);
      const eventBus = new EventBus();

      const thresholdMs = parseInt(opts.threshold, 10);
      const terminatedSessions = cleanupStaleSessions(odb, thresholdMs, eventBus);
      const releasedLocks = cleanupExpiredLocks(odb, eventBus);

      if (json) {
        console.log(
          JSON.stringify({
            terminatedSessions: terminatedSessions.length,
            releasedLocks,
          }),
        );
        return;
      }

      console.log(`Terminated ${terminatedSessions.length} stale session(s).`);
      console.log(`Released ${releasedLocks} expired lock(s).`);
    });
}
