import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerWatchCommand } from "../commands/watch.js";

describe("Watch command registration", () => {
  it("registers watch command without errors", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    expect(() => registerWatchCommand(program)).not.toThrow();

    const watchCmd = program.commands.find((c) => c.name() === "watch");
    expect(watchCmd).toBeDefined();
  });

  it("has correct description mentioning live tail", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWatchCommand(program);

    const watchCmd = program.commands.find((c) => c.name() === "watch");
    expect(watchCmd!.description()).toContain("Live tail");
  });

  it("expects a runId argument", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");
    registerWatchCommand(program);

    const watchCmd = program.commands.find((c) => c.name() === "watch");
    const args = watchCmd!.registeredArguments;
    expect(args.length).toBe(1);
    expect(args[0]!.name()).toBe("runId");
  });

  it("does not conflict with other commands", () => {
    const program = new Command();
    program.option("--db-path <path>").option("--json");

    program.command("other").description("other command");
    registerWatchCommand(program);

    const names = program.commands.map((c) => c.name());
    expect(names).toContain("watch");
    expect(names).toContain("other");
  });
});
