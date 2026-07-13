#!/usr/bin/env node

import { Command } from "commander";
import { registerRunCommands } from "./commands/run.js";
import { registerPolicyCommands } from "./commands/policy.js";
import { registerReportCommand } from "./commands/report.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerLinkCommands } from "./commands/link.js";
// Orchestration commands — uncomment as workstreams land
import { registerSessionCommands } from "./commands/session.js";
import { registerEventsCommands } from "./commands/events.js";
import { registerInitCommand } from "./commands/init.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerHookCommand } from "./commands/hook.js";
import { registerUserCommands } from "./commands/user.js";
import { registerLoginCommands } from "./commands/login.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerCleanupCommand } from "./commands/cleanup.js";
import { registerAdminCommands } from "./commands/admin.js";
import { VERSION, GIT_SHA, DIRTY, BUILT_AT } from "./build-info.js";

const program = new Command();

// `agentops --version` returns the package version stitched with the
// git short SHA, a -dirty marker when the build was made from a dirty
// tree, and the build date. Makes "what version is this?" the first
// thing every support conversation can answer.
const versionString =
  `${VERSION} (${GIT_SHA}${DIRTY ? "-dirty" : ""}, built ${BUILT_AT.slice(0, 10)})`;

program
  .name("agentops")
  .description("AgentOps CLI - manage and observe agent runs")
  .version(versionString)
  .option("--db-path <path>", "Path to the AgentOps database")
  .option("--json", "Output results as JSON");

registerRunCommands(program);
registerPolicyCommands(program);
registerReportCommand(program);
registerWrapCommand(program);
registerWatchCommand(program);
registerLinkCommands(program);
registerSessionCommands(program);
registerEventsCommands(program);
registerInitCommand(program);
registerServeCommand(program);
registerSetupCommand(program);
registerHookCommand(program);
registerUserCommands(program);
registerLoginCommands(program);
registerDoctorCommand(program);
registerCleanupCommand(program);
registerAdminCommands(program);

program.parse();
