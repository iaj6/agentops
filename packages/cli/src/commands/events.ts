import { Command } from "commander";
import { EventCategory } from "@agentops/core";
import type { AgentEvent } from "@agentops/core";
import {
  getDb,
  listEvents,
  getEventsBySource,
  getRecentEvents,
  createEventPollCursor,
  advanceEventPollCursor,
} from "@agentops/db";
import { table } from "../format.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

function colorCategory(category: string): string {
  switch (category) {
    case EventCategory.Job:
      return cyan(category);
    case EventCategory.Run:
      return green(category);
    case EventCategory.Session:
      return yellow(category);
    case EventCategory.Policy:
      return red(category);
    case EventCategory.Cost:
      return magenta(category);
    case EventCategory.Action:
      return green(category);
    default:
      return category;
  }
}

function formatEvent(event: AgentEvent): string[] {
  const ts = new Date(event.timestamp).toLocaleString();
  return [
    dim(event.id as string),
    colorCategory(event.category),
    event.type,
    event.sourceId,
    dim(ts),
  ];
}

export function registerEventsCommands(program: Command): void {
  const events = program
    .command("events")
    .description("Manage and view events");

  events
    .command("list")
    .description("List events with optional filters")
    .option("--category <category>", "Filter by category")
    .option("--type <type>", "Filter by event type")
    .option("--since <timestamp>", "Events since ISO timestamp")
    .option("--limit <n>", "Max events to show", "50")
    .action((opts) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const db = getDb(dbPath);
      const json = program.opts()["json"] as boolean | undefined;

      const results = listEvents(db, {
        category: opts.category,
        type: opts.type,
        since: opts.since,
        limit: parseInt(opts.limit, 10),
      });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No events found.");
        return;
      }

      console.log(
        table(
          ["ID", "Category", "Type", "Source", "Timestamp"],
          results.map(formatEvent),
        ),
      );
      console.log(dim(`\n${results.length} event(s)`));
    });

  events
    .command("tail")
    .description("Live tail of events (polls every 1s)")
    .option("--type <type>", "Filter by event type")
    .action((opts) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const db = getDb(dbPath);

      console.log(bold("Tailing events..."));
      console.log(dim("Press Ctrl+C to stop"));
      console.log();

      // listEvents' `since` is inclusive (gte) so equal-timestamp events
      // are never dropped; the cursor tracks IDs already printed at the
      // boundary timestamp so nothing is printed twice.
      let cursor = createEventPollCursor(new Date().toISOString());

      const interval = setInterval(() => {
        const batch = listEvents(db, {
          type: opts.type,
          since: cursor.since,
          limit: 100,
        });

        const { fresh, next } = advanceEventPollCursor(cursor, batch);
        cursor = next;

        for (const event of fresh) {
          const now = new Date().toLocaleTimeString();
          console.log(
            `${dim(now)} ${colorCategory(event.category)} ${cyan(event.type)} ${dim(event.sourceId)}`,
          );
        }
      }, 1000);

      process.on("SIGINT", () => {
        clearInterval(interval);
        console.log();
        console.log(dim("Stopped tailing."));
        process.exit(0);
      });
    });

  events
    .command("for")
    .description("Show events for a specific entity")
    .argument("<sourceId>", "The source entity ID")
    .option("--limit <n>", "Max events to show", "50")
    .action((sourceId: string, opts) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const db = getDb(dbPath);
      const json = program.opts()["json"] as boolean | undefined;

      const results = getEventsBySource(db, sourceId, parseInt(opts.limit, 10));

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No events found for source: ${sourceId}`);
        return;
      }

      console.log(bold(`Events for ${sourceId}`));
      console.log(
        table(
          ["ID", "Category", "Type", "Source", "Timestamp"],
          results.map(formatEvent),
        ),
      );
      console.log(dim(`\n${results.length} event(s)`));
    });
}
