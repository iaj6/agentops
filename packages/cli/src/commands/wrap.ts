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
  createEvent,
  EVENT_TYPES,
  EventCategory,
  computeScore,
  PolicyEngine,
  generateSummary,
  normalizeRepo,
} from "@agentops/core";
import type { Run, Action, Command as CmdType, FileEdit } from "@agentops/core";
import { getDb, insertRun, updateRun, insertEvent, listPolicies, updateRunSummary } from "@agentops/db";
import { getCurrentRepo, getCurrentBranch, getWorkingTreeDiff, getChangedFiles } from "../git.js";
import { resolveLocalUserId } from "../attribution.js";
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

        // Canonicalize whether the repo came from --repo or auto-detection, so
        // an explicit override buckets the same as everything else. getCurrentRepo
        // already normalizes; normalizeRepo is idempotent, so this is safe.
        const repo = normalizeRepo(opts.repo ?? getCurrentRepo());
        const branch = opts.branch ?? getCurrentBranch();
        const commandStr = args.join(" ");
        const goal = opts.goal ?? `Run: ${commandStr}`;

        // Take "before" diff snapshot
        const diffBefore = getWorkingTreeDiff();

        // Create and start the run BEFORE execution so it appears in the dashboard
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
        // Attribute the run to the local user at write time (else it lands with
        // a NULL user_id); null when attribution can't be determined.
        run = { ...run, userId: resolveLocalUserId(db) };
        insertRun(db, run);

        // Emit run.started event for real-time dashboard updates
        insertEvent(
          db,
          createEvent(EventCategory.Run, EVENT_TYPES["run.started"], run.id as string, {
            goal,
            command: commandStr,
            repo,
            branch,
          }),
        );

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

        // Throttle state for action events during execution
        let lastEventTime = 0;
        const EVENT_THROTTLE_MS = 1000;
        let outputBuffer = "";

        function flushOutputEvent(): void {
          if (outputBuffer.length === 0) return;
          insertEvent(
            db,
            createEvent(EventCategory.Action, EVENT_TYPES["action.taken"], run.id as string, {
              type: "output",
              content: outputBuffer.slice(0, 2000),
              elapsedMs: Date.now() - startTime,
            }),
          );
          outputBuffer = "";
          lastEventTime = Date.now();
        }

        function onOutput(text: string): void {
          outputBuffer += text;
          const now = Date.now();
          if (now - lastEventTime >= EVENT_THROTTLE_MS) {
            flushOutputEvent();
          }
        }

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
            onOutput(text);
          });

          child.stderr.on("data", (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            if (!json) process.stderr.write(text);
            onOutput(text);
          });

          child.on("close", (code) => {
            resolve(code ?? 1);
          });

          child.on("error", (err) => {
            stderr += err.message;
            resolve(1);
          });
        });

        // Flush any remaining buffered output as a final action event
        flushOutputEvent();

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

        // Run scoring and generate summary
        const activePolicies = listPolicies(db, { enabled: true });
        const score = computeScore(run, activePolicies);
        const engine = new PolicyEngine();
        const policyResults = engine.evaluate(run, activePolicies);
        const summary = generateSummary(run, run.metrics, policyResults, score);
        updateRunSummary(db, run.id, summary);

        // Emit final run event for real-time dashboard updates
        if (exitCode === 0) {
          insertEvent(
            db,
            createEvent(EventCategory.Run, EVENT_TYPES["run.completed"], run.id as string, {
              exitCode,
              wallTimeMs,
              filesChanged: fileEdits.length,
            }),
          );
        } else {
          insertEvent(
            db,
            createEvent(EventCategory.Run, EVENT_TYPES["run.failed"], run.id as string, {
              exitCode,
              wallTimeMs,
              error: stderr.slice(0, 500),
            }),
          );
        }

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
