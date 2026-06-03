import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each(["/runs", "/runs/abc?tab=1", "/", "/settings#section"])(
    "passes same-origin relative path %s through",
    (p) => {
      expect(safeNextPath(p)).toBe(p);
    },
  );

  it.each([
    "https://attacker.example/phish",
    "http://attacker.example",
    "//attacker.example", // protocol-relative
    "/\\attacker.example", // backslash → // in some browsers
    "javascript:alert(1)",
    "mailto:x@y.z",
    "runs", // relative without leading slash
    "",
  ])("rejects unsafe target %s → /", (p) => {
    expect(safeNextPath(p)).toBe("/");
  });

  it("rejects null/undefined → /", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});
