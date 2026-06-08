import { describe, it, expect } from "vitest";
import { normalizeRepo } from "../repo.js";

describe("normalizeRepo", () => {
  it("extracts owner/name from an SSH remote and lowercases", () => {
    expect(normalizeRepo("git@github.com:Acme/Backend.git")).toBe("acme/backend");
  });

  it("extracts owner/name from an HTTPS remote with .git", () => {
    expect(normalizeRepo("https://github.com/Acme/Backend.git")).toBe("acme/backend");
  });

  it("extracts owner/name from an HTTPS remote without .git", () => {
    expect(normalizeRepo("https://github.com/acme/backend")).toBe("acme/backend");
  });

  it("passes through a bare owner/name slug, lowercased", () => {
    expect(normalizeRepo("Acme/Repo")).toBe("acme/repo");
  });

  it("strips a trailing .git from a bare slug", () => {
    expect(normalizeRepo("owner/repo.git")).toBe("owner/repo");
  });

  it("keeps a single-segment basename, lowercased", () => {
    expect(normalizeRepo("My-Cool-Repo")).toBe("my-cool-repo");
  });

  it("passes through the 'unknown' fallback unchanged", () => {
    expect(normalizeRepo("unknown")).toBe("unknown");
  });

  it("de-duplicates case-variant slugs to one canonical key", () => {
    expect(normalizeRepo("Iaj6/AgentOps")).toBe(normalizeRepo("iaj6/agentops"));
    expect(normalizeRepo("Iaj6/AgentOps")).toBe("iaj6/agentops");
  });

  it("trims surrounding whitespace and slashes", () => {
    expect(normalizeRepo("  owner/repo/  ")).toBe("owner/repo");
  });

  it("collapses a deeper URL path to owner/name", () => {
    expect(normalizeRepo("https://github.com/Owner/Repo/tree/main")).toBe("owner/repo");
  });

  it("is idempotent", () => {
    for (const input of [
      "git@github.com:Acme/Backend.git",
      "https://github.com/Acme/Backend.git",
      "Acme/Repo",
      "My-Cool-Repo",
      "unknown",
      "owner/repo.git",
    ]) {
      const once = normalizeRepo(input);
      expect(normalizeRepo(once)).toBe(once);
    }
  });

  it("returns an empty string for empty/whitespace input", () => {
    expect(normalizeRepo("")).toBe("");
    expect(normalizeRepo("   ")).toBe("");
  });
});
