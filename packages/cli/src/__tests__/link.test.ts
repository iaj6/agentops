import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerLinkCommands } from "../commands/link.js";

describe("Link command registration", () => {
  it("registers link command with pr and issue subcommands", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerLinkCommands(program)).not.toThrow();

    const linkCmd = program.commands.find((c) => c.name() === "link");
    expect(linkCmd).toBeDefined();

    const subcommands = linkCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("pr");
    expect(subcommands).toContain("issue");
  });

  it("pr subcommand accepts runId argument and --branch option", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerLinkCommands(program);

    const linkCmd = program.commands.find((c) => c.name() === "link");
    const prCmd = linkCmd!.commands.find((c) => c.name() === "pr");
    expect(prCmd).toBeDefined();

    // Verify it has an argument
    const args = prCmd!.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.name()).toBe("runId");

    // Verify it has the --branch option
    const branchOpt = prCmd!.options.find((o) => o.long === "--branch");
    expect(branchOpt).toBeDefined();
  });

  it("issue subcommand accepts runId and issueNumber arguments", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerLinkCommands(program);

    const linkCmd = program.commands.find((c) => c.name() === "link");
    const issueCmd = linkCmd!.commands.find((c) => c.name() === "issue");
    expect(issueCmd).toBeDefined();

    const args = issueCmd!.registeredArguments;
    expect(args).toHaveLength(2);
    expect(args[0]!.name()).toBe("runId");
    expect(args[1]!.name()).toBe("issueNumber");
  });

  it("can register alongside other commands without conflict", () => {
    const program = new Command();
    program
      .name("agentops")
      .option("--db-path <path>")
      .option("--json");

    // Add a dummy command first
    program.command("run").description("Manage runs");

    expect(() => registerLinkCommands(program)).not.toThrow();

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("link");
  });
});
