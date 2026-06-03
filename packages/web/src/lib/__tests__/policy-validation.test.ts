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

  it("ignores non-secretDetection configs (other validation lives elsewhere)", () => {
    expect(validatePolicyConfigForWrite({ type: "costCeiling", maxUsd: 10 })).toBeNull();
    expect(validatePolicyConfigForWrite(null)).toBeNull();
    expect(validatePolicyConfigForWrite("nope")).toBeNull();
  });
});
