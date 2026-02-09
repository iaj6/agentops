import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerRunCommands } from "../commands/run.js";
import { registerPolicyCommands } from "../commands/policy.js";
import { registerReportCommand } from "../commands/report.js";

describe("CLI command registration", () => {
  it("registers run commands without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerRunCommands(program)).not.toThrow();

    // Verify subcommands were registered
    const runCmd = program.commands.find((c) => c.name() === "run");
    expect(runCmd).toBeDefined();

    const subcommands = runCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("start");
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("complete");
    expect(subcommands).toContain("fail");
  });

  it("registers policy commands without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerPolicyCommands(program)).not.toThrow();

    const policyCmd = program.commands.find((c) => c.name() === "policy");
    expect(policyCmd).toBeDefined();

    const subcommands = policyCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("add");
    expect(subcommands).toContain("evaluate");
  });

  it("registers report command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerReportCommand(program)).not.toThrow();

    const reportCmd = program.commands.find((c) => c.name() === "report");
    expect(reportCmd).toBeDefined();
  });

  it("all commands can be registered together without conflict", () => {
    const program = new Command();
    program
      .name("agentops")
      .option("--db-path <path>")
      .option("--json");

    expect(() => {
      registerRunCommands(program);
      registerPolicyCommands(program);
      registerReportCommand(program);
    }).not.toThrow();

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("policy");
    expect(commandNames).toContain("report");
  });
});
