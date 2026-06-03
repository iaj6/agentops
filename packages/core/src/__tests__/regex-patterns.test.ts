import { describe, it, expect } from "vitest";
import { compileRegexPatterns, findInvalidRegexPatterns } from "../policy.js";

describe("findInvalidRegexPatterns", () => {
  it("returns [] when every pattern compiles", () => {
    expect(findInvalidRegexPatterns(["abc", "[0-9]{4}", "^x.*y$"])).toEqual([]);
  });

  it("returns the patterns that don't compile", () => {
    const invalid = findInvalidRegexPatterns(["ok", "([unterminated", "also-ok", "a{99,1}"]);
    expect(invalid).toContain("([unterminated");
    expect(invalid).toContain("a{99,1}"); // quantifier out of order
    expect(invalid).not.toContain("ok");
  });
});

describe("compileRegexPatterns", () => {
  it("drops invalid patterns and compiles the rest", () => {
    const compiled = compileRegexPatterns(["foo", "([bad", "ba[rz]"]);
    expect(compiled.map((c) => c.source)).toEqual(["foo", "ba[rz]"]);
    expect(compiled[1]!.re.test("baz")).toBe(true);
  });

  it("returns [] for an all-invalid set without throwing", () => {
    expect(() => compileRegexPatterns(["([a", "*b"])).not.toThrow();
    expect(compileRegexPatterns(["([a", "*b"])).toEqual([]);
  });
});
