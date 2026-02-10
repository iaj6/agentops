import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerWrapCommand } from "../commands/wrap.js";

describe("Wrap command registration", () => {
  it("registers wrap command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerWrapCommand(program)).not.toThrow();

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    expect(wrapCmd).toBeDefined();
  });

  it("has correct description", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWrapCommand(program);

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    expect(wrapCmd!.description()).toContain("Wrap");
  });

  it("accepts --goal option", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWrapCommand(program);

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    const options = wrapCmd!.options.map((o) => o.long);
    expect(options).toContain("--goal");
  });

  it("accepts --repo option", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWrapCommand(program);

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    const options = wrapCmd!.options.map((o) => o.long);
    expect(options).toContain("--repo");
  });

  it("accepts --branch option", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWrapCommand(program);

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    const options = wrapCmd!.options.map((o) => o.long);
    expect(options).toContain("--branch");
  });

  it("expects an argument for the command to wrap", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWrapCommand(program);

    const wrapCmd = program.commands.find((c) => c.name() === "wrap");
    // Commander stores registered arguments
    const args = wrapCmd!.registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0]!.name()).toBe("args");
  });

  it("does not conflict with other commands", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    // Register wrap alongside another command
    program.command("other").description("other command");
    registerWrapCommand(program);

    const names = program.commands.map((c) => c.name());
    expect(names).toContain("wrap");
    expect(names).toContain("other");
  });
});
