import { findInvalidRegexPatterns } from "@agentops/core";

// Validate a policy `config` blob at write time (create/replace/patch).
// Returns an error message if invalid, or null if OK.
//
// Currently guards SecretDetection regex patterns: a pattern that doesn't
// compile would otherwise be persisted and then throw inside `new RegExp`
// during evaluation — 500ing the SDK policy-check/complete routes and, in
// the local hook's fail-open default, silently disabling enforcement.
export function validatePolicyConfigForWrite(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const cfg = config as { type?: unknown; patterns?: unknown };

  if (cfg.type === "secretDetection") {
    if (!Array.isArray(cfg.patterns) || cfg.patterns.some((p) => typeof p !== "string")) {
      return "secretDetection config requires a `patterns` array of strings";
    }
    const invalid = findInvalidRegexPatterns(cfg.patterns as string[]);
    if (invalid.length > 0) {
      return `Invalid regex pattern(s) in secretDetection config: ${invalid.join(", ")}`;
    }
  }

  return null;
}
