import { describe, it, expect } from "vitest";
import { validatePolicyConfigForWrite } from "@/lib/policy-validation";

describe("validatePolicyConfigForWrite", () => {
  it("accepts a secretDetection config whose patterns all compile", () => {
    expect(
      validatePolicyConfigForWrite({ type: "secretDetection", patterns: ["AKIA[0-9A-Z]{16}", "tok_[a-z]+"] }),
    ).toBeNull();
  });

  it("rejects a secretDetection config with an invalid regex", () => {
    const err = validatePolicyConfigForWrite({ type: "secretDetection", patterns: ["ok", "([bad"] });
    expect(err).toBeTruthy();
    expect(err).toContain("([bad");
  });

  it("rejects a secretDetection config whose patterns aren't all strings", () => {
    expect(
      validatePolicyConfigForWrite({ type: "secretDetection", patterns: ["ok", 42] }),
    ).toBeTruthy();
  });

  it("rejects a secretDetection config with no patterns array", () => {
    expect(validatePolicyConfigForWrite({ type: "secretDetection" })).toBeTruthy();
  });

  it("ignores configs without specific validation (e.g. costCeiling)", () => {
    expect(validatePolicyConfigForWrite({ type: "costCeiling", maxUsd: 10 })).toBeNull();
    expect(validatePolicyConfigForWrite(null)).toBeNull();
    expect(validatePolicyConfigForWrite("nope")).toBeNull();
  });

  it("rejects fileLimitCount with maxFiles < 1 (blocks every new-file edit)", () => {
    expect(validatePolicyConfigForWrite({ type: "fileLimitCount", maxFiles: 0 })).toBeTruthy();
    expect(validatePolicyConfigForWrite({ type: "fileLimitCount", maxFiles: -3 })).toBeTruthy();
    expect(validatePolicyConfigForWrite({ type: "fileLimitCount", maxFiles: 2.5 })).toBeTruthy();
    expect(validatePolicyConfigForWrite({ type: "fileLimitCount", maxFiles: 50 })).toBeNull();
  });

  it("rejects a toolRestriction with neither allowedTools nor blockedTools", () => {
    expect(validatePolicyConfigForWrite({ type: "toolRestriction" })).toBeTruthy();
    expect(validatePolicyConfigForWrite({ type: "toolRestriction", allowedTools: [], blockedTools: [] })).toBeTruthy();
    expect(validatePolicyConfigForWrite({ type: "toolRestriction", blockedTools: ["Write"] })).toBeNull();
    expect(validatePolicyConfigForWrite({ type: "toolRestriction", allowedTools: ["Read"] })).toBeNull();
  });
});
