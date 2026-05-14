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

        // Handle existing database
        if (existsSync(dbPath)) {
          if (opts.clean) {
            const yes = await confirm(
              `This will delete all data in ${dbPath}. Continue?`,
            );
            if (!yes) {
              console.log("Aborted.");
              return;
            }
            unlinkSync(dbPath);
            // Also remove WAL and SHM files if they exist
            if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
            if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
          } else {
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

        if (opts.seed) {
          const counts = await seed(db);
          if (json) {
            console.log(JSON.stringify({ status: "initialized", path: dbPath, seeded: true, counts }));
          } else {
            console.log(`Database initialized at ${dbPath}`);
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
                status: "initialized",
                path: dbPath,
                starterPolicies: {
                  inserted: result.inserted,
                  skipped: result.skipped,
                },
              }),
            );
          } else {
            console.log(`Database initialized at ${dbPath}`);
            console.log(`Starter policies: ${result.inserted.length} installed, ${result.skipped.length} already present`);
            for (const name of result.inserted) console.log(`  + ${name}`);
            for (const name of result.skipped) console.log(`  = ${name} (skipped)`);
          }
        } else {
          if (json) {
            console.log(JSON.stringify({ status: "initialized", path: dbPath, seeded: false }));
          } else {
            console.log(`Database initialized at ${dbPath}`);
          }
        }
      },
    );
}
