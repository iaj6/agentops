import { Command } from "commander";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { getDb, seed, loadStarterPolicies } from "@agentops/db";

const DEFAULT_DB_PATH = resolve(homedir(), ".agentops", "agentops.db");

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize the AgentOps database")
    .option("--seed", "Populate database with sample data (dev / demo only)")
    .option(
      "--seed-policies",
      "Install the curated starter policy set (safe for production use)",
    )
    .option("--clean", "Drop and recreate database from scratch")
    .action(
      async (opts: { seed?: boolean; seedPolicies?: boolean; clean?: boolean }) => {
        const dbPath = (program.opts()["dbPath"] as string | undefined) ?? DEFAULT_DB_PATH;
        const json = program.opts()["json"] as boolean | undefined;

        // Handle existing database. The seed flags must be honored even
        // when the DB already exists — both seed() and loadStarterPolicies()
        // are idempotent (existing rows are skipped, not duplicated).
        // Previously a pre-existing DB short-circuited the entire command
        // and silently ignored --seed / --seed-policies.
        let preExisted = false;
        if (existsSync(dbPath)) {
          preExisted = true;
          if (opts.clean) {
            const yes = await confirm(
              `This will delete all data in ${dbPath}. Continue?`,
            );
            if (!yes) {
              console.log("Aborted.");
              return;
            }
            unlinkSync(dbPath);
            if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
            if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
            preExisted = false;
          } else if (!opts.seed && !opts.seedPolicies) {
            // DB exists and nothing to seed — bail with the existing message.
            if (json) {
              console.log(JSON.stringify({ status: "exists", path: dbPath }));
            } else {
              console.log(`Already initialized at ${dbPath}`);
            }
            return;
          }
        }

        // Create database and run migrations (getDb handles both)
        const db = getDb(dbPath);
        const headline = preExisted
          ? `Database at ${dbPath} (existing)`
          : `Database initialized at ${dbPath}`;
        const status = preExisted ? "exists" : "initialized";

        if (opts.seed) {
          const counts = await seed(db);
          if (json) {
            console.log(JSON.stringify({ status, path: dbPath, seeded: true, counts }));
          } else {
            console.log(headline);
            console.log(`Seeded with:`);
            console.log(`  Policies:       ${counts.policies}`);
            console.log(`  Runs:           ${counts.runs}`);
            console.log(`  Policy results: ${counts.policyResults}`);
            console.log(`  Sessions:       ${counts.sessions}`);
            console.log(`  Events:         ${counts.events}`);
          }
        } else if (opts.seedPolicies) {
          const result = loadStarterPolicies(db);
          if (json) {
            console.log(
              JSON.stringify({
                status,
                path: dbPath,
                starterPolicies: {
                  inserted: result.inserted,
                  skipped: result.skipped,
                },
              }),
            );
          } else {
            console.log(headline);
            console.log(`Starter policies: ${result.inserted.length} installed, ${result.skipped.length} already present`);
            for (const name of result.inserted) console.log(`  + ${name}`);
            for (const name of result.skipped) console.log(`  = ${name} (skipped)`);
          }
        } else {
          if (json) {
            console.log(JSON.stringify({ status, path: dbPath, seeded: false }));
          } else {
            console.log(headline);
          }
        }
      },
    );
}
