import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerPRCommand } from "../commands/pr.js";

describe("PR command registration", () => {
  it("registers pr command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerPRCommand(program)).not.toThrow();

    const prCmd = program.commands.find((c) => c.name() === "pr");
    expect(prCmd).toBeDefined();
  });

  it("pr command accepts runId argument", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerPRCommand(program);

    const prCmd = program.commands.find((c) => c.name() === "pr");
    const args = prCmd!.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.name()).toBe("runId");
  });

  it("pr command has --base option defaulting to main", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerPRCommand(program);

    const prCmd = program.commands.find((c) => c.name() === "pr");
    const baseOpt = prCmd!.options.find((o) => o.long === "--base");
    expect(baseOpt).toBeDefined();
    expect(baseOpt!.defaultValue).toBe("main");
  });

  it("can register alongside link and other commands", () => {
    const program = new Command();
    program
      .name("agentops")
      .option("--db-path <path>")
      .option("--json");

    program.command("run").description("Manage runs");
    program.command("link").description("Link GitHub resources");

    expect(() => registerPRCommand(program)).not.toThrow();

    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("link");
    expect(commandNames).toContain("pr");
  });

  it("pr command has correct description", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerPRCommand(program);

    const prCmd = program.commands.find((c) => c.name() === "pr");
    expect(prCmd!.description()).toContain("PR");
  });
});
