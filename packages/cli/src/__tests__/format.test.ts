import { describe, it, expect } from "vitest";
import { colorStatus, colorBool, table } from "../format.js";

describe("colorStatus", () => {
  it("returns green for completed", () => {
    const result = colorStatus("completed");
    expect(result).toContain("completed");
    // Contains ANSI green code
    expect(result).toContain("\x1b[32m");
  });

  it("returns red for failed", () => {
    const result = colorStatus("failed");
    expect(result).toContain("failed");
    expect(result).toContain("\x1b[31m");
  });

  it("returns red for cancelled", () => {
    const result = colorStatus("cancelled");
    expect(result).toContain("cancelled");
    expect(result).toContain("\x1b[31m");
  });

  it("returns yellow for pending", () => {
    const result = colorStatus("pending");
    expect(result).toContain("pending");
    expect(result).toContain("\x1b[33m");
  });

  it("returns yellow for blocked", () => {
    const result = colorStatus("blocked");
    expect(result).toContain("blocked");
    expect(result).toContain("\x1b[33m");
  });

  it("returns green for running", () => {
    const result = colorStatus("running");
    expect(result).toContain("running");
    expect(result).toContain("\x1b[32m");
  });

  it("returns plain string for unknown status", () => {
    const result = colorStatus("unknown");
    expect(result).toBe("unknown");
  });
});

describe("colorBool", () => {
  it("returns green PASS for true", () => {
    const result = colorBool(true);
    expect(result).toContain("PASS");
    expect(result).toContain("\x1b[32m");
  });

  it("returns red FAIL for false", () => {
    const result = colorBool(false);
    expect(result).toContain("FAIL");
    expect(result).toContain("\x1b[31m");
  });
});

describe("table", () => {
  it("renders a table with headers and rows", () => {
    const headers = ["Name", "Value"];
    const rows = [
      ["foo", "bar"],
      ["baz", "qux"],
    ];

    const output = table(headers, rows);
    const lines = output.split("\n");

    // Header line
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Value");

    // Separator line
    expect(lines[1]).toContain("-");
    expect(lines[1]).toContain("+");

    // Data rows
    expect(lines[2]).toContain("foo");
    expect(lines[2]).toContain("bar");
    expect(lines[3]).toContain("baz");
    expect(lines[3]).toContain("qux");
  });

  it("handles empty rows", () => {
    const output = table(["A", "B"], []);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2); // header + separator
  });

  it("handles columns of different widths", () => {
    const output = table(["Short", "A much longer header"], [
      ["x", "y"],
      ["longer value here", "z"],
    ]);

    // Should not throw and should produce valid output
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("handles ANSI-colored cell content without breaking alignment", () => {
    const colored = "\x1b[32mcompleted\x1b[0m";
    const output = table(["Status"], [[colored]]);

    const lines = output.split("\n");
    // The header and data should both exist
    expect(lines[0]).toContain("Status");
    expect(lines[2]).toContain("completed");
  });
});
