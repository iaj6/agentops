import { Command } from "commander";
import {
  SessionStatus,
  createSessionId,
  terminateSession as coreTerminateSession,
} from "@agentops/core";
import { getDb, getSession, listSessions, updateSession, getActiveSessions } from "@agentops/db";
import { table, colorStatus } from "../format.js";

export function registerSessionCommands(program: Command): void {
  const session = program.command("session").description("Manage agent sessions");

  session
    .command("list")
    .description("List recent sessions")
    .option("--status <status>", "Filter by status")
    .option("--limit <n>", "Max results", "20")
    .action((opts: { status?: string; limit: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = listSessions(db, {
        status: opts.status,
        limit: parseInt(opts.limit, 10),
      });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No sessions found.");
        return;
      }

      const rows = results.map((s) => [
        s.id as string,
        colorStatus(s.status),
        s.agentId as string,
        s.currentRunId ? (s.currentRunId as string) : "-",
        s.createdAt,
      ]);

      console.log(table(["ID", "Status", "Agent", "Current Run", "Created"], rows));
    });

  session
    .command("status")
    .description("Show session status and details")
    .argument("<sessionId>", "The session ID")
    .action((sessionId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const s = getSession(db, createSessionId(sessionId));

      if (!s) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      if (json) {
        console.log(JSON.stringify(s, null, 2));
        return;
      }

      console.log(`Session:     ${s.id}`);
      console.log(`Status:      ${colorStatus(s.status)}`);
      console.log(`Agent:       ${s.agentId}`);
      console.log(`Current Run: ${s.currentRunId ?? "none"}`);
      console.log(`Completed:   ${s.completedRunIds.length} runs`);
      console.log(`Started:     ${s.startedAt}`);
      console.log(`Heartbeat:   ${s.lastHeartbeatAt}`);
      console.log(`Created:     ${s.createdAt}`);
      console.log(`Updated:     ${s.updatedAt}`);

      if (s.terminatedAt) {
        console.log(`Terminated:  ${s.terminatedAt}`);
      }

      console.log();
      console.log(`Resource Usage:`);
      console.log(`  Memory:   ${s.resourceUsage.memoryMb} MB`);
      console.log(`  CPU:      ${s.resourceUsage.cpuPercent}%`);
      console.log(`  Tokens:   ${s.resourceUsage.tokensBudgetRemaining} remaining`);
      console.log(`  Budget:   $${s.resourceUsage.costBudgetRemaining.toFixed(2)} remaining`);

      if (s.completedRunIds.length > 0) {
        console.log();
        console.log(`Completed Runs:`);
        for (const runId of s.completedRunIds) {
          console.log(`  ${runId}`);
        }
      }
    });

  session
    .command("terminate")
    .description("Terminate a session")
    .argument("<sessionId>", "The session ID")
    .action((sessionId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);
      const s = getSession(db, createSessionId(sessionId));

      if (!s) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }

      const terminated = coreTerminateSession(s);
      updateSession(db, terminated.id, {
        status: terminated.status,
        terminatedAt: terminated.terminatedAt,
        updatedAt: terminated.updatedAt,
      });

      if (json) {
        console.log(JSON.stringify({ id: terminated.id, status: terminated.status }));
      } else {
        console.log(`Session ${sessionId} closed.`);
        console.log(`Note: This marks the session as closed in AgentOps. It does not stop the running Claude Code process.`);
      }
    });

  session
    .command("active")
    .description("List all active sessions with current runs")
    .action(() => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = getActiveSessions(db);

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No active sessions.");
        return;
      }

      const rows = results.map((s) => [
        s.id as string,
        s.agentId as string,
        s.currentRunId ? (s.currentRunId as string) : "-",
        `${s.completedRunIds.length}`,
        s.lastHeartbeatAt,
      ]);

      console.log(table(["ID", "Agent", "Current Run", "Completed", "Last Heartbeat"], rows));
    });
}
