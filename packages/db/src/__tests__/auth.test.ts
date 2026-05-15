import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import type { AgentOpsDb } from "../connection.js";
import {
  hashPassword,
  verifyPassword,
  generateApiToken,
  hashApiToken,
  countUsers,
  insertUser,
  getUserByEmail,
  getUserById,
  getUserWithPasswordByEmail,
  listUsers,
  setUserPassword,
  issueApiToken,
  getUserByRawApiToken,
  listApiTokensForUser,
  listAllApiTokens,
  getApiTokenById,
  revokeApiToken,
  createAuthSession,
  getUserBySessionId,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  createDeviceCode,
  getDeviceCodeByUserCode,
  getDeviceCodeByDeviceCode,
  approveDeviceCode,
  consumeApprovedDeviceCode,
  denyDeviceCode,
} from "../auth.js";

describe("password hashing", () => {
  it("hash and verify roundtrip", () => {
    const stored = hashPassword("hunter2");
    expect(verifyPassword("hunter2", stored)).toBe(true);
    expect(verifyPassword("hunter3", stored)).toBe(false);
  });

  it("two hashes of the same password are different (salt)", () => {
    const a = hashPassword("hunter2");
    const b = hashPassword("hunter2");
    expect(a).not.toBe(b);
    expect(verifyPassword("hunter2", a)).toBe(true);
    expect(verifyPassword("hunter2", b)).toBe(true);
  });

  it("rejects malformed stored value", () => {
    expect(verifyPassword("hunter2", "")).toBe(false);
    expect(verifyPassword("hunter2", "not-a-scrypt-string")).toBe(false);
    expect(verifyPassword("hunter2", "scrypt$N=16384,r=8,p=1$badsalt")).toBe(false);
  });
});

describe("API token generation", () => {
  it("generates ao_ prefixed tokens with stored hash", () => {
    const { raw, hash } = generateApiToken();
    expect(raw.startsWith("ao_")).toBe(true);
    expect(hash).toBe(hashApiToken(raw));
    expect(hash).not.toBe(raw);
    expect(hash.length).toBe(64); // sha256 hex
  });

  it("two tokens are distinct", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("user CRUD", () => {
  let db: AgentOpsDb;
  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("countUsers is 0 on empty DB", () => {
    expect(countUsers(db)).toBe(0);
  });

  it("first user is auto-admin", () => {
    const u = insertUser(db, { email: "first@example.com", password: "x" });
    expect(u.role).toBe("admin");
    expect(countUsers(db)).toBe(1);
  });

  it("subsequent users default to member", () => {
    insertUser(db, { email: "first@example.com", password: "x" });
    const u = insertUser(db, { email: "second@example.com", password: "y" });
    expect(u.role).toBe("member");
  });

  it("explicit admin role honored", () => {
    insertUser(db, { email: "first@example.com", password: "x" });
    const u = insertUser(db, {
      email: "second@example.com",
      password: "y",
      role: "admin",
    });
    expect(u.role).toBe("admin");
  });

  it("emails are lowercased and trimmed", () => {
    const u = insertUser(db, { email: "  Foo@Example.COM ", password: "x" });
    expect(u.email).toBe("foo@example.com");
    expect(getUserByEmail(db, "FOO@example.com")?.id).toBe(u.id);
  });

  it("getUserByEmail and getUserById", () => {
    const u = insertUser(db, { email: "a@example.com", password: "p" });
    expect(getUserByEmail(db, "a@example.com")?.id).toBe(u.id);
    expect(getUserById(db, u.id)?.email).toBe("a@example.com");
    expect(getUserByEmail(db, "nope@example.com")).toBeNull();
  });

  it("getUserWithPasswordByEmail returns hash for verification", () => {
    insertUser(db, { email: "a@example.com", password: "secretpw" });
    const result = getUserWithPasswordByEmail(db, "a@example.com");
    expect(result).not.toBeNull();
    expect(verifyPassword("secretpw", result!.passwordHash)).toBe(true);
    expect(verifyPassword("wrong", result!.passwordHash)).toBe(false);
  });

  it("listUsers ordered by creation time", () => {
    insertUser(db, { email: "a@example.com", password: "p" });
    insertUser(db, { email: "b@example.com", password: "p" });
    const users = listUsers(db);
    expect(users.map((u) => u.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("setUserPassword updates hash and clears mustChangePassword", () => {
    const u = insertUser(db, {
      email: "a@example.com",
      password: "old",
      mustChangePassword: true,
    });
    setUserPassword(db, u.id, "new");
    const after = getUserWithPasswordByEmail(db, "a@example.com")!;
    expect(verifyPassword("new", after.passwordHash)).toBe(true);
    expect(verifyPassword("old", after.passwordHash)).toBe(false);
    expect(after.user.mustChangePassword).toBe(false);
  });
});

describe("API tokens", () => {
  let db: AgentOpsDb;
  let userId: string;
  beforeEach(() => {
    db = getDb(":memory:");
    userId = insertUser(db, { email: "a@example.com", password: "p" }).id;
  });

  it("issue returns raw exactly once; getUserByRawApiToken finds it", () => {
    const { raw } = issueApiToken(db, { userId, name: "laptop" });
    const u = getUserByRawApiToken(db, raw);
    expect(u?.id).toBe(userId);
  });

  it("invalid token returns null", () => {
    expect(getUserByRawApiToken(db, "ao_fake")).toBeNull();
  });

  it("expired token returns null", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const { raw } = issueApiToken(db, { userId, name: "expired", expiresAt: past });
    expect(getUserByRawApiToken(db, raw)).toBeNull();
  });

  it("listApiTokensForUser returns issued tokens (no raw)", () => {
    issueApiToken(db, { userId, name: "laptop" });
    issueApiToken(db, { userId, name: "desktop" });
    const tokens = listApiTokensForUser(db, userId);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.name).sort()).toEqual(["desktop", "laptop"]);
  });

  it("revokeApiToken removes it", () => {
    const { token, raw } = issueApiToken(db, { userId, name: "x" });
    revokeApiToken(db, token.id);
    expect(getUserByRawApiToken(db, raw)).toBeNull();
  });
});

describe("browser auth sessions", () => {
  let db: AgentOpsDb;
  let userId: string;
  beforeEach(() => {
    db = getDb(":memory:");
    userId = insertUser(db, { email: "a@example.com", password: "p" }).id;
  });

  it("creates a session and resolves to user", () => {
    const s = createAuthSession(db, userId);
    expect(s.id.startsWith("as_")).toBe(true);
    expect(getUserBySessionId(db, s.id)?.id).toBe(userId);
  });

  it("unknown session returns null", () => {
    expect(getUserBySessionId(db, "as_nope")).toBeNull();
  });

  it("deleted session does not resolve", () => {
    const s = createAuthSession(db, userId);
    deleteAuthSession(db, s.id);
    expect(getUserBySessionId(db, s.id)).toBeNull();
  });

  it("deleteExpiredAuthSessions removes only expired", () => {
    const s = createAuthSession(db, userId);
    // No expired ones yet
    expect(deleteExpiredAuthSessions(db)).toBe(0);
    expect(getUserBySessionId(db, s.id)).not.toBeNull();
  });
});

describe("device authorization codes", () => {
  let db: AgentOpsDb;
  let userId: string;
  beforeEach(() => {
    db = getDb(":memory:");
    userId = insertUser(db, { email: "a@example.com", password: "p" }).id;
  });

  it("creates pending code with user_code in XXXX-XXXX format", () => {
    const c = createDeviceCode(db);
    expect(c.status).toBe("pending");
    expect(c.deviceCode.startsWith("dc_")).toBe(true);
    expect(c.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("user_code lookup is case-insensitive", () => {
    const c = createDeviceCode(db);
    expect(getDeviceCodeByUserCode(db, c.userCode.toLowerCase())?.deviceCode).toBe(
      c.deviceCode,
    );
  });

  it("approveDeviceCode transitions pending to approved", () => {
    const c = createDeviceCode(db);
    const { token } = issueApiToken(db, { userId, name: "device" });
    const ok = approveDeviceCode(db, {
      userCode: c.userCode,
      userId,
      tokenId: token.id,
    });
    expect(ok).toBe(true);
    const updated = getDeviceCodeByDeviceCode(db, c.deviceCode)!;
    expect(updated.status).toBe("approved");
    expect(updated.userId).toBe(userId);
    expect(updated.tokenId).toBe(token.id);
    expect(updated.approvedAt).not.toBeNull();
  });

  it("approveDeviceCode fails on already-approved code", () => {
    const c = createDeviceCode(db);
    const { token } = issueApiToken(db, { userId, name: "device" });
    approveDeviceCode(db, { userCode: c.userCode, userId, tokenId: token.id });
    const second = approveDeviceCode(db, {
      userCode: c.userCode,
      userId,
      tokenId: token.id,
    });
    expect(second).toBe(false);
  });

  it("denyDeviceCode transitions pending to denied", () => {
    const c = createDeviceCode(db);
    expect(denyDeviceCode(db, c.userCode)).toBe(true);
    expect(getDeviceCodeByDeviceCode(db, c.deviceCode)?.status).toBe("denied");
  });

  it("unknown user_code returns null on lookup", () => {
    expect(getDeviceCodeByUserCode(db, "XXXX-XXXX")).toBeNull();
  });

  it("consumeApprovedDeviceCode returns token once and only once", () => {
    const c = createDeviceCode(db);
    const { token } = issueApiToken(db, { userId, name: "device" });
    approveDeviceCode(db, {
      userCode: c.userCode,
      userId,
      tokenId: token.id,
      rawToken: "ao_FAKE",
    });

    const first = consumeApprovedDeviceCode(db, c.deviceCode);
    expect(first).toEqual({ rawToken: "ao_FAKE", userId });

    // Second call returns null — the token is single-use.
    expect(consumeApprovedDeviceCode(db, c.deviceCode)).toBeNull();

    // Status moved to "consumed" so the device cannot be reused.
    expect(getDeviceCodeByDeviceCode(db, c.deviceCode)?.status).toBe("consumed");
  });

  it("consumeApprovedDeviceCode returns null when not approved", () => {
    const c = createDeviceCode(db);
    expect(consumeApprovedDeviceCode(db, c.deviceCode)).toBeNull();
  });

  it("consumeApprovedDeviceCode returns null on unknown device code", () => {
    expect(consumeApprovedDeviceCode(db, "dc_nope")).toBeNull();
  });
});

describe("listAllApiTokens", () => {
  let db: AgentOpsDb;
  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("returns empty array on empty DB", () => {
    expect(listAllApiTokens(db)).toEqual([]);
  });

  it("returns tokens from multiple users", () => {
    const u1 = insertUser(db, { email: "u1@example.com", password: "p" }).id;
    const u2 = insertUser(db, { email: "u2@example.com", password: "p" }).id;
    issueApiToken(db, { userId: u1, name: "u1-token" });
    issueApiToken(db, { userId: u2, name: "u2-token" });

    const tokens = listAllApiTokens(db);
    expect(tokens).toHaveLength(2);
    const userIds = tokens.map((t) => t.userId);
    expect(userIds).toContain(u1);
    expect(userIds).toContain(u2);
  });

  it("orders by created_at DESC (newest first)", async () => {
    const userId = insertUser(db, { email: "a@example.com", password: "p" }).id;
    const { token: t1 } = issueApiToken(db, { userId, name: "older" });
    // small delay to get a different timestamp
    await new Promise((r) => setTimeout(r, 15));
    const { token: t2 } = issueApiToken(db, { userId, name: "newer" });

    const tokens = listAllApiTokens(db);
    expect(tokens[0]!.id).toBe(t2.id);
    expect(tokens[1]!.id).toBe(t1.id);
  });
});

describe("getApiTokenById", () => {
  let db: AgentOpsDb;
  let userId: string;
  beforeEach(() => {
    db = getDb(":memory:");
    userId = insertUser(db, { email: "a@example.com", password: "p" }).id;
  });

  it("returns null when token does not exist", () => {
    expect(getApiTokenById(db, "no-such-id")).toBeNull();
  });

  it("returns the matching token row", () => {
    const { token } = issueApiToken(db, { userId, name: "my-token" });
    const found = getApiTokenById(db, token.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(token.id);
    expect(found!.userId).toBe(userId);
    expect(found!.name).toBe("my-token");
  });

  it("returns null after revokeApiToken", () => {
    const { token } = issueApiToken(db, { userId, name: "revoked-token" });
    revokeApiToken(db, token.id);
    expect(getApiTokenById(db, token.id)).toBeNull();
  });
});
