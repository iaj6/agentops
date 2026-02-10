import { Command } from "commander";
import {
  LockType,
  createLockId,
  createLock,
  releaseLock,
  checkConflicts,
} from "@agentops/core";
import {
  getDb,
  insertLock,
  getLock,
  listLocks,
  updateLock,
  getActiveLocks,
  releaseExpiredLocks,
} from "@agentops/db";
import { table, colorStatus } from "../format.js";

export function registerLockCommands(program: Command): void {
  const lock = program.command("lock").description("Manage resource locks");

  lock
    .command("list")
    .description("List resource locks")
    .option("--resource <resource>", "Filter by resource")
    .option("--active", "Only show active locks")
    .option("--limit <n>", "Max results", "20")
    .action((opts: { resource?: string; active?: boolean; limit: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = listLocks(db, {
        resource: opts.resource,
        active: opts.active,
        limit: parseInt(opts.limit, 10),
      });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No locks found.");
        return;
      }

      const rows = results.map((l) => [
        l.id as string,
        l.lockType,
        l.resource,
        l.holderId,
        l.released ? "released" : new Date(l.expiresAt) < new Date() ? "expired" : "active",
        l.acquiredAt,
      ]);

      console.log(table(["ID", "Type", "Resource", "Holder", "Status", "Acquired"], rows));
    });

  lock
    .command("acquire")
    .description("Acquire a resource lock")
    .argument("<resource>", "The resource to lock")
    .option("--type <type>", "Lock type (repo, path, branch)", "repo")
    .option("--holder <holder>", "Lock holder ID", "cli-user")
    .option("--duration <ms>", "Lock duration in milliseconds", "300000")
    .action((resource: string, opts: { type: string; holder: string; duration: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const lockType = opts.type as LockType;
      if (!Object.values(LockType).includes(lockType)) {
        console.error(`Invalid lock type: ${opts.type}. Must be one of: ${Object.values(LockType).join(", ")}`);
        process.exit(1);
      }

      // Check for conflicts
      const active = getActiveLocks(db, resource);
      const conflicts = checkConflicts(resource, lockType, active);

      if (conflicts.hasConflict) {
        console.error(`Cannot acquire lock: ${conflicts.message}`);
        process.exit(1);
      }

      const newLock = createLock(lockType, resource, opts.holder, parseInt(opts.duration, 10));
      insertLock(db, newLock);

      if (json) {
        console.log(JSON.stringify({ id: newLock.id, resource: newLock.resource, expiresAt: newLock.expiresAt }));
      } else {
        console.log(`Lock acquired: ${newLock.id}`);
        console.log(`  Resource: ${newLock.resource}`);
        console.log(`  Expires:  ${newLock.expiresAt}`);
      }
    });

  lock
    .command("release")
    .description("Release a lock")
    .argument("<lockId>", "The lock ID to release")
    .action((lockId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const existing = getLock(db, createLockId(lockId));
      if (!existing) {
        console.error(`Lock not found: ${lockId}`);
        process.exit(1);
      }

      if (existing.released) {
        console.error(`Lock already released: ${lockId}`);
        process.exit(1);
      }

      const released = releaseLock(existing);
      updateLock(db, released.id, { released: released.released });

      if (json) {
        console.log(JSON.stringify({ id: released.id, released: true }));
      } else {
        console.log(`Lock ${lockId} released.`);
      }
    });

  lock
    .command("check")
    .description("Check who holds a lock on a resource")
    .argument("<resource>", "The resource to check")
    .action((resource: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const active = getActiveLocks(db, resource);

      if (json) {
        console.log(JSON.stringify(active, null, 2));
        return;
      }

      if (active.length === 0) {
        console.log(`No active locks on: ${resource}`);
        return;
      }

      console.log(`Active locks on ${resource}:`);
      for (const l of active) {
        console.log(`  ${l.id} — held by ${l.holderId} (${l.lockType}), expires ${l.expiresAt}`);
      }
    });

  lock
    .command("cleanup")
    .description("Release all expired locks")
    .action(() => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const count = releaseExpiredLocks(db);

      if (json) {
        console.log(JSON.stringify({ released: count }));
      } else {
        console.log(`Released ${count} expired lock(s).`);
      }
    });
}
