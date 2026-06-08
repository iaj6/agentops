import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { getDb, insertUser, type AgentOpsDb } from "@agentops/db";
import { resolveLocalUserId } from "../attribution.js";

let tmpHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;
let db: AgentOpsDb;

beforeEach(() => {
  // Redirect HOME so resolveLocalUserId reads our fixture credentials.json
  // (via readCredentials → homedir()/.agentops/), not the real one.
  tmpHome = resolve(
    tmpdir(),
    `agentops-attr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(tmpHome, ".agentops"), { recursive: true });
  origHome = process.env["HOME"];
  origUserProfile = process.env["USERPROFILE"];
  process.env["HOME"] = tmpHome;
  process.env["USERPROFILE"] = tmpHome;
  db = getDb(resolve(tmpHome, "test.db"));
});

afterEach(() => {
  if (origHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = origHome;
  if (origUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = origUserProfile;
  rmSync(tmpHome, { recursive: true, force: true });
});

// server is empty so this fixture can never trip SDK mode elsewhere;
// resolveLocalUserId only reads creds.user.email.
function writeCreds(email: string, id = "remote-dashboard-uuid"): void {
  writeFileSync(
    join(tmpHome, ".agentops", "credentials.json"),
    JSON.stringify({ server: "", token: "x", user: { id, email } }),
  );
}

describe("resolveLocalUserId", () => {
  it("returns null with no credentials and no local users", () => {
    expect(resolveLocalUserId(db)).toBeNull();
  });

  it("falls back to the sole local user when there are no credentials", () => {
    const u = insertUser(db, { email: "solo@example.com", password: "pw" });
    expect(resolveLocalUserId(db)).toBe(u.id);
  });

  it("returns null with multiple users and no credentials (ambiguous)", () => {
    insertUser(db, { email: "a@example.com", password: "pw" });
    insertUser(db, { email: "b@example.com", password: "pw" });
    expect(resolveLocalUserId(db)).toBeNull();
  });

  it("resolves the local user by credentials email, not the remote id", () => {
    const a = insertUser(db, { email: "a@example.com", password: "pw" });
    insertUser(db, { email: "b@example.com", password: "pw" });
    // creds.user.id is a bogus remote UUID; matching must be by email.
    writeCreds("a@example.com");
    expect(resolveLocalUserId(db)).toBe(a.id);
  });

  it("credentials take precedence over the sole-user fallback", () => {
    // Exactly one user (which alone would trigger the fallback), but creds are
    // present and match no one → null, NOT the lone user. The creds branch wins.
    insertUser(db, { email: "solo@example.com", password: "pw" });
    writeCreds("someone-else@example.com");
    expect(resolveLocalUserId(db)).toBeNull();
  });

  it("returns null when the credentials email matches no local user", () => {
    insertUser(db, { email: "a@example.com", password: "pw" });
    insertUser(db, { email: "b@example.com", password: "pw" });
    writeCreds("ghost@example.com");
    expect(resolveLocalUserId(db)).toBeNull();
  });

  it("matches the credentials email case-insensitively", () => {
    const a = insertUser(db, { email: "Mixed@Example.com", password: "pw" });
    insertUser(db, { email: "other@example.com", password: "pw" });
    writeCreds("mixed@example.COM");
    expect(resolveLocalUserId(db)).toBe(a.id);
  });

  it("fails open to null on a corrupt credentials file", () => {
    insertUser(db, { email: "a@example.com", password: "pw" });
    insertUser(db, { email: "b@example.com", password: "pw" });
    writeFileSync(join(tmpHome, ".agentops", "credentials.json"), "{not json");
    // readCredentials swallows the parse error → null creds → ambiguous (2 users) → null.
    expect(resolveLocalUserId(db)).toBeNull();
  });
});
