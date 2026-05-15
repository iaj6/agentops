import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertUser,
  createAuthSession,
  getUserWithPasswordByEmail,
  verifyPassword,
  type AgentOpsDb,
} from "@agentops/db";
import { makeMemoryDb, anonRequest, jsonOf } from "@/__tests__/_helpers";
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
import { GET as listUsersRoute, POST as inviteUserRoute } from "@/app/api/users/route";

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

// ─── GET /api/users ───────────────────────────────────────────────────────────

describe("GET /api/users", () => {
  it("401 without auth", async () => {
    const req = anonRequest("http://localhost/api/users", { method: "GET" });
    const res = await listUsersRoute(req);
    expect(res.status).toBe(401);
  });

  it("any authenticated user (member) can read the full roster", async () => {
    // Seed two users: one admin, one member.
    insertUser(db, {
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
    const session = createAuthSession(db, member.id);

    const req = cookieRequest("http://localhost/api/users", {
      method: "GET",
      cookie: session.id,
    });
    const res = await listUsersRoute(req);
    expect(res.status).toBe(200);

    const body = (await jsonOf(res)) as {
      users: Array<{ email: string; role: string; id: string; name: string | null; createdAt: string }>;
    };
    // Both users should appear in the roster.
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    const emails = body.users.map((u) => u.email);
    expect(emails).toContain("admin@acme.com");
    expect(emails).toContain("member@acme.com");
  });

  it("response objects contain id, email, name, role, createdAt — no passwordHash", async () => {
    const u = insertUser(db, { email: "check@acme.com", name: "Check User", password: "p" });
    const session = createAuthSession(db, u.id);

    const req = cookieRequest("http://localhost/api/users", {
      method: "GET",
      cookie: session.id,
    });
    const res = await listUsersRoute(req);
    const body = (await jsonOf(res)) as { users: Array<Record<string, unknown>> };
    const found = body.users.find((x) => x.email === "check@acme.com");
    expect(found).toBeTruthy();
    expect(found!.id).toBeTruthy();
    expect(found!.email).toBe("check@acme.com");
    expect(found!.name).toBe("Check User");
    expect(found!.role).toBeTruthy();
    expect(found!.createdAt).toBeTruthy();
    // Sensitive fields must not be present.
    expect("passwordHash" in found!).toBe(false);
    expect("password" in found!).toBe(false);
  });
});

// ─── POST /api/users (invite) — supplemental cases ───────────────────────────
// NOTE: The core invite tests (admin success, non-admin 403, duplicate 409,
// malformed email 400, unauth 401) live in auth-routes.test.ts which already
// imports this route. The cases below cover the remaining items not tested
// there: missing email body field.

describe("POST /api/users (invite) — supplemental", () => {
  function seedAdmin() {
    const u = insertUser(db, {
      email: "admin@acme.com",
      name: "Admin",
      password: "first-password",
      role: "admin",
      mustChangePassword: false,
    });
    const session = createAuthSession(db, u.id);
    return { sessionId: session.id };
  }

  it("400 on missing email field", async () => {
    const { sessionId } = seedAdmin();
    const req = cookieRequest("http://localhost/api/users", {
      method: "POST",
      cookie: sessionId,
      body: { name: "No Email" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(400);
  });

  it("tempPassword actually authenticates the new user (hash round-trip)", async () => {
    const { sessionId } = seedAdmin();
    const req = cookieRequest("http://localhost/api/users", {
      method: "POST",
      cookie: sessionId,
      body: { email: "roundtrip@acme.com", name: "Round Trip", role: "member" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(201);

    const body = (await jsonOf(res)) as { user: { email: string }; tempPassword: string };
    const stored = getUserWithPasswordByEmail(db, "roundtrip@acme.com");
    expect(stored).not.toBeNull();
    expect(verifyPassword(body.tempPassword, stored!.passwordHash)).toBe(true);
  });
});
