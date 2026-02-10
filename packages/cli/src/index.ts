#!/usr/bin/env node

import { Command } from "commander";
import { registerRunCommands } from "./commands/run.js";
import { registerPolicyCommands } from "./commands/policy.js";
import { registerReportCommand } from "./commands/report.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerLinkCommands } from "./commands/link.js";
import { registerPRCommand } from "./commands/pr.js";

const program = new Command();

program
  .name("agentops")
  .description("AgentOps CLI - manage and observe agent runs")
  .version("0.1.0")
  .option("--db-path <path>", "Path to the AgentOps database")
  .option("--json", "Output results as JSON");

registerRunCommands(program);
registerPolicyCommands(program);
registerReportCommand(program);
registerWrapCommand(program);
registerWatchCommand(program);
registerLinkCommands(program);
registerPRCommand(program);

program.parse();
