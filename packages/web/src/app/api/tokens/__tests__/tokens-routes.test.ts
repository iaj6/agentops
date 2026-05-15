import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertUser,
  createAuthSession,
  issueApiToken,
  listAllApiTokens,
  type AgentOpsDb,
} from "@agentops/db";
import {
  makeMemoryDb,
  anonRequest,
  jsonOf,
  withParams,
} from "@/__tests__/_helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";

const { getTestDb, setTestDb } = vi.hoisted(() => {
  let _db: AgentOpsDb | null = null;
  return {
    getTestDb: () => {
      if (!_db) throw new Error("Test DB not set");
      return _db;
    },
    setTestDb: (db: AgentOpsDb) => {
      _db = db;
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: () => getTestDb(),
}));

// Route imports must come AFTER vi.mock.
import { GET as listTokensRoute } from "@/app/api/tokens/route";
import { DELETE as deleteTokenRoute } from "@/app/api/tokens/[id]/route";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
});

// Build a NextRequest with a session cookie.
function cookieRequest(
  url: string,
  init: {
    method?: string;
    cookie?: string;
    body?: unknown;
  } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-request-id": "test-req-id",
    ...(init.cookie ? { Cookie: `${SESSION_COOKIE_NAME}=${init.cookie}` } : {}),
  };
  const { NextRequest } = require("next/server");
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

// ─── GET /api/tokens ─────────────────────────────────────────────────────────

describe("GET /api/tokens", () => {
  it("401 without auth", async () => {
    const req = anonRequest("http://localhost/api/tokens", { method: "GET" });
    const res = await listTokensRoute(req);
    expect(res.status).toBe(401);
  });

  it("admin sees tokens belonging to multiple users", async () => {
    const admin = insertUser(db, {
      email: "admin@acme.com",
      name: "Alice Admin",
      password: "p",
      role: "admin",
    });
    const member = insertUser(db, {
      email: "member@acme.com",
      name: "Bob Member",
      password: "p",
      role: "member",
    });

    issueApiToken(db, { userId: admin.id, name: "admin-token" });
    issueApiToken(db, { userId: member.id, name: "member-token" });

    const session = createAuthSession(db, admin.id);
    const req = cookieRequest("http://localhost/api/tokens", {
      method: "GET",
      cookie: session.id,
    });
    const res = await listTokensRoute(req);
    expect(res.status).toBe(200);

    const body = (await jsonOf(res)) as {
      tokens: Array<{
        id: string;
        name: string;
        ownerId: string;
        ownerLabel: string;
        createdAt: string;
        lastUsedAt: string | null;
        expiresAt: string | null;
      }>;
    };
    expect(body.tokens.length).toBeGreaterThanOrEqual(2);

    const ownerIds = body.tokens.map((t) => t.ownerId);
    expect(ownerIds).toContain(admin.id);
    expect(ownerIds).toContain(member.id);
  });

  it("ownerLabel uses name when present, falls back to email", async () => {
    const withName = insertUser(db, {
      email: "named@acme.com",
      name: "Has Name",
      password: "p",
      role: "admin",
    });
    const withoutName = insertUser(db, {
      email: "noname@acme.com",
      password: "p",
      role: "member",
    });

    issueApiToken(db, { userId: withName.id, name: "t1" });
    issueApiToken(db, { userId: withoutName.id, name: "t2" });

    const session = createAuthSession(db, withName.id);
    const req = cookieRequest("http://localhost/api/tokens", {
      method: "GET",
      cookie: session.id,
    });
    const res = await listTokensRoute(req);
    const body = (await jsonOf(res)) as {
      tokens: Array<{ ownerId: string; ownerLabel: string }>;
    };

    const namedToken = body.tokens.find((t) => t.ownerId === withName.id);
    const unnamedToken = body.tokens.find((t) => t.ownerId === withoutName.id);

    expect(namedToken?.ownerLabel).toBe("Has Name");
    expect(unnamedToken?.ownerLabel).toBe("noname@acme.com");
  });

  it("member sees only their own tokens", async () => {
    const admin = insertUser(db, {
      email: "admin@acme.com",
      name: "Admin",
      password: "p",
      role: "admin",
    });
    const member = insertUser(db, {
      email: "member@acme.com",
      name: "Member",
      password: "p",
      role: "member",
    });

    issueApiToken(db, { userId: admin.id, name: "admin-token" });
    issueApiToken(db, { userId: member.id, name: "my-token" });

    const session = createAuthSession(db, member.id);
    const req = cookieRequest("http://localhost/api/tokens", {
      method: "GET",
      cookie: session.id,
    });
    const res = await listTokensRoute(req);
    expect(res.status).toBe(200);

    const body = (await jsonOf(res)) as {
      tokens: Array<{ ownerId: string }>;
    };
    // Member only sees their own tokens — no admin token should appear.
    expect(body.tokens.every((t) => t.ownerId === member.id)).toBe(true);
    expect(body.tokens.length).toBe(1);
  });
});

// ─── DELETE /api/tokens/[id] ─────────────────────────────────────────────────

describe("DELETE /api/tokens/[id]", () => {
  it("401 without auth", async () => {
    const req = anonRequest("http://localhost/api/tokens/tok_fake", {
      method: "DELETE",
    });
    const res = await deleteTokenRoute(req, withParams({ id: "tok_fake" }));
    expect(res.status).toBe(401);
  });

  it("404 for a non-existent token", async () => {
    const admin = insertUser(db, { email: "admin@acme.com", password: "p", role: "admin" });
    const session = createAuthSession(db, admin.id);

    const req = cookieRequest("http://localhost/api/tokens/tok_does_not_exist", {
      method: "DELETE",
      cookie: session.id,
    });
    const res = await deleteTokenRoute(req, withParams({ id: "tok_does_not_exist" }));
    expect(res.status).toBe(404);
  });

  it("member can revoke their own token and it disappears from DB", async () => {
    const member = insertUser(db, { email: "member@acme.com", password: "p", role: "member" });
    const { token } = issueApiToken(db, { userId: member.id, name: "my-token" });
    const session = createAuthSession(db, member.id);

    const req = cookieRequest(`http://localhost/api/tokens/${token.id}`, {
      method: "DELETE",
      cookie: session.id,
    });
    const res = await deleteTokenRoute(req, withParams({ id: token.id }));
    expect(res.status).toBe(200);

    // Token should be gone from DB.
    const remaining = listAllApiTokens(db);
    expect(remaining.find((t) => t.id === token.id)).toBeUndefined();
  });

  it("member cannot revoke another user's token — gets 404 (not 403)", async () => {
    const admin = insertUser(db, { email: "admin@acme.com", password: "p", role: "admin" });
    const member = insertUser(db, { email: "member@acme.com", password: "p", role: "member" });

    const { token: adminToken } = issueApiToken(db, { userId: admin.id, name: "admin-tok" });
    const session = createAuthSession(db, member.id);

    const req = cookieRequest(`http://localhost/api/tokens/${adminToken.id}`, {
      method: "DELETE",
      cookie: session.id,
    });
    const res = await deleteTokenRoute(req, withParams({ id: adminToken.id }));
    // Must be 404, not 403, to avoid leaking that the token ID exists.
    expect(res.status).toBe(404);

    // Admin's token must still be in the DB.
    const remaining = listAllApiTokens(db);
    expect(remaining.find((t) => t.id === adminToken.id)).toBeTruthy();
  });

  it("admin can revoke any user's token", async () => {
    const admin = insertUser(db, { email: "admin@acme.com", password: "p", role: "admin" });
    const member = insertUser(db, { email: "member@acme.com", password: "p", role: "member" });

    const { token: memberToken } = issueApiToken(db, { userId: member.id, name: "member-tok" });
    const session = createAuthSession(db, admin.id);

    const req = cookieRequest(`http://localhost/api/tokens/${memberToken.id}`, {
      method: "DELETE",
      cookie: session.id,
    });
    const res = await deleteTokenRoute(req, withParams({ id: memberToken.id }));
    expect(res.status).toBe(200);

    // Member's token should be gone.
    const remaining = listAllApiTokens(db);
    expect(remaining.find((t) => t.id === memberToken.id)).toBeUndefined();
  });

  it("second DELETE on a revoked token returns 404", async () => {
    const admin = insertUser(db, { email: "admin@acme.com", password: "p", role: "admin" });
    const { token } = issueApiToken(db, { userId: admin.id, name: "once" });
    const session = createAuthSession(db, admin.id);

    const makeReq = () =>
      cookieRequest(`http://localhost/api/tokens/${token.id}`, {
        method: "DELETE",
        cookie: session.id,
      });

    // First revocation.
    const res1 = await deleteTokenRoute(makeReq(), withParams({ id: token.id }));
    expect(res1.status).toBe(200);

    // Second call: token is gone, should 404.
    const res2 = await deleteTokenRoute(makeReq(), withParams({ id: token.id }));
    expect(res2.status).toBe(404);
  });

  it("tokens from other tests are not visible in an isolated DB (sanity check)", async () => {
    // Fresh DB per beforeEach: no tokens should exist yet.
    const all = listAllApiTokens(db);
    expect(all).toHaveLength(0);
  });
});
