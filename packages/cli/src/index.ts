#!/usr/bin/env node

import { Command } from "commander";
import { registerRunCommands } from "./commands/run.js";
import { registerPolicyCommands } from "./commands/policy.js";
import { registerReportCommand } from "./commands/report.js";

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

program.parse();
