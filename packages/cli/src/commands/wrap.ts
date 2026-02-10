import { Command } from "commander";
import { spawn } from "node:child_process";
import {
  createRun,
  startRun,
  completeRun,
  failRun,
  addAction,
  createActionId,
  createArtifactId,
  addArtifact,
} from "@agentops/core";
import type { Run, Action, Command as CmdType, FileEdit } from "@agentops/core";
import { getDb, insertRun, updateRun } from "@agentops/db";
import { getCurrentRepo, getCurrentBranch, getWorkingTreeDiff, getChangedFiles } from "../git.js";
import { colorStatus } from "../format.js";

export function registerWrapCommand(program: Command): void {
  program
    .command("wrap")
    .description("Wrap a command execution and record it as an AgentOps run")
    .option("--goal <goal>", "Goal description for the run")
    .option("--repo <repo>", "Override detected repo name")
    .option("--branch <branch>", "Override detected branch name")
    .allowUnknownOption(false)
    .argument("<args...>", "Command to execute (after --)")
    .action(
      async (
        args: string[],
        opts: { goal?: string; repo?: string; branch?: string },
      ) => {
        const dbPath = program.opts()["dbPath"] as string | undefined;
        const json = program.opts()["json"] as boolean | undefined;
        const db = getDb(dbPath);

        const repo = opts.repo ?? getCurrentRepo();
        const branch = opts.branch ?? getCurrentBranch();
        const commandStr = args.join(" ");
        const goal = opts.goal ?? `Run: ${commandStr}`;

        // Take "before" diff snapshot
        const diffBefore = getWorkingTreeDiff();

        // Create and start the run
        let run = createRun(
          {
            humanReadable: goal,
            structured: {
              type: "command",
              description: goal,
              parameters: { command: commandStr },
            },
          },
          {
            repo,
            branch,
            permissions: [],
            sandbox: { enabled: false, isolationLevel: "none" },
          },
        );
        run = startRun(run);
        insertRun(db, run);

        if (!json) {
          console.log(`Run started: ${run.id}`);
          console.log(`Command:     ${commandStr}`);
          console.log(`Repo:        ${repo}`);
          console.log(`Branch:      ${branch}`);
          console.log();
        }

        const startTime = Date.now();
        let stdout = "";
        let stderr = "";

        // Execute the command
        const exitCode = await new Promise<number>((resolve) => {
          const child = spawn(args[0]!, args.slice(1), {
            stdio: ["inherit", "pipe", "pipe"],
            shell: true,
            cwd: process.cwd(),
          });

          child.stdout.on("data", (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            if (!json) process.stdout.write(text);
          });

          child.stderr.on("data", (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            if (!json) process.stderr.write(text);
          });

          child.on("close", (code) => {
            resolve(code ?? 1);
          });

          child.on("error", (err) => {
            stderr += err.message;
            resolve(1);
          });
        });

        const wallTimeMs = Date.now() - startTime;

        // Take "after" diff snapshot
        const diffAfter = getWorkingTreeDiff();

        // Compute file edits from changed files
        const changedFiles = getChangedFiles();
        const fileEdits: FileEdit[] = changedFiles.map((f) => ({
          path: f.path,
          diff: "", // Full diff is stored in artifacts
          timestamp: new Date().toISOString(),
        }));

        // Build the command record
        const cmd: CmdType = {
          command: commandStr,
          exitCode,
          stdout: stdout.slice(0, 10000), // Cap at 10KB
          stderr: stderr.slice(0, 10000),
          timestamp: new Date().toISOString(),
        };

        // Create an action for the wrapped command
        const action: Action = {
          id: createActionId(`action_${Date.now()}`),
          toolCalls: [],
          fileEdits,
          commands: [cmd],
          timestamp: new Date().toISOString(),
        };

        run = addAction(run, action);

        // Store diffs as an artifact
        run = addArtifact(run, {
          id: createArtifactId(`artifact_${Date.now()}`),
          diffs: [diffBefore, diffAfter],
          logs: [stdout.slice(0, 50000)],
          testOutputs: [],
          reports: [],
        });

        // Update metrics
        run = {
          ...run,
          metrics: {
            ...run.metrics,
            wallTimeMs,
          },
        };

        // Mark completed or failed
        if (exitCode === 0) {
          run = completeRun(run, {
            testResults: [],
            policyChecks: [],
            confidenceScore: 0,
          });
        } else {
          run = failRun(run, `Command exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
        }

        // Persist final state
        updateRun(db, run.id, {
          status: run.status,
          actions: run.actions,
          artifacts: run.artifacts,
          metrics: run.metrics,
          evaluations: run.evaluations,
          decisions: run.decisions,
          updatedAt: run.updatedAt,
        });

        if (!json) {
          console.log();
          console.log(`─────────────────────────────────`);
          console.log(`Run:      ${run.id}`);
          console.log(`Status:   ${colorStatus(run.status)}`);
          console.log(`Exit:     ${exitCode}`);
          console.log(`Duration: ${wallTimeMs}ms`);
          console.log(`Files:    ${fileEdits.length} changed`);
        } else {
          console.log(
            JSON.stringify({
              id: run.id,
              status: run.status,
              exitCode,
              wallTimeMs,
              filesChanged: fileEdits.length,
            }),
          );
        }

        process.exit(exitCode);
      },
    );
}
