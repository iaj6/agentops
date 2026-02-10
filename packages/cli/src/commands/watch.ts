import { Command } from "commander";
import { createRunId } from "@agentops/core";
import type { Run } from "@agentops/core";
import { getDb, getRun } from "@agentops/db";
import { colorStatus } from "../format.js";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Live tail of a run's status (polls every 2s)")
    .argument("<runId>", "The run ID to watch")
    .action((runId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const db = getDb(dbPath);
      const id = createRunId(runId);

      const initial = getRun(db, id);
      if (!initial) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      console.log(bold(`Watching run: ${runId}`));
      console.log(dim("Press Ctrl+C to stop"));
      console.log();

      let lastStatus = "";
      let lastActionCount = 0;
      let lastArtifactCount = 0;
      let lastUpdatedAt = "";

      function printUpdate(run: Run): void {
        const now = new Date().toLocaleTimeString();

        if (run.status !== lastStatus) {
          console.log(`${dim(now)} ${cyan("STATUS")}  ${colorStatus(run.status)}`);
          lastStatus = run.status;
        }

        const actionCount = run.actions.length;
        if (actionCount > lastActionCount) {
          const newActions = run.actions.slice(lastActionCount);
          for (const action of newActions) {
            const cmdCount = action.commands.length;
            const editCount = action.fileEdits.length;
            const toolCount = action.toolCalls.length;
            const parts: string[] = [];
            if (cmdCount > 0) parts.push(`${cmdCount} cmd`);
            if (editCount > 0) parts.push(`${editCount} edits`);
            if (toolCount > 0) parts.push(`${toolCount} tools`);
            console.log(
              `${dim(now)} ${green("ACTION")}  ${action.id} [${parts.join(", ")}]`,
            );
          }
          lastActionCount = actionCount;
        }

        const artifactCount = run.artifacts.length;
        if (artifactCount > lastArtifactCount) {
          const newArtifacts = run.artifacts.slice(lastArtifactCount);
          for (const artifact of newArtifacts) {
            const parts: string[] = [];
            if (artifact.diffs.length > 0) parts.push(`${artifact.diffs.length} diffs`);
            if (artifact.logs.length > 0) parts.push(`${artifact.logs.length} logs`);
            if (artifact.testOutputs.length > 0)
              parts.push(`${artifact.testOutputs.length} tests`);
            console.log(
              `${dim(now)} ${cyan("ARTIFACT")} ${artifact.id} [${parts.join(", ")}]`,
            );
          }
          lastArtifactCount = artifactCount;
        }

        if (run.updatedAt !== lastUpdatedAt && run.updatedAt !== lastUpdatedAt) {
          lastUpdatedAt = run.updatedAt;
        }

        // Check for terminal state
        if (isTerminal(run.status)) {
          console.log();
          console.log(
            `${dim(now)} ${bold("DONE")}    Run ${run.status} (${run.metrics.wallTimeMs}ms)`,
          );

          if (run.status === "failed" && run.decisions.length > 0) {
            const lastDecision = run.decisions[run.decisions.length - 1];
            if (lastDecision) {
              console.log(`         ${red("Reason:")} ${lastDecision.reason}`);
            }
          }
        }
      }

      // Initial print
      printUpdate(initial);

      if (isTerminal(initial.status)) {
        return;
      }

      const interval = setInterval(() => {
        const run = getRun(db, id);
        if (!run) {
          console.error(`Run disappeared: ${runId}`);
          clearInterval(interval);
          process.exit(1);
        }

        printUpdate(run);

        if (isTerminal(run.status)) {
          clearInterval(interval);
        }
      }, 2000);

      // Handle Ctrl+C gracefully
      process.on("SIGINT", () => {
        clearInterval(interval);
        console.log();
        console.log(dim("Stopped watching."));
        process.exit(0);
      });
    });
}
