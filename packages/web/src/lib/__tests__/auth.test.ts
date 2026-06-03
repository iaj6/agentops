import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  insertUser,
  insertRun,
  insertSession,
  issueApiToken,
  createAuthSession,
  type AgentOpsDb,
} from "@agentops/db";
import {
  createRun,
  startRun,
  createSession,
  activateSession,
} from "@agentops/core";
import { makeMemoryDb, anonRequest, authedRequest } from "@/__tests__/_helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-constants";
import { NextRequest } from "next/server";

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

import {
  getRequestUser,
  requireUser,
  requireBearerUser,
  requireAdmin,
  requireOwnedRun,
  requireOwnedSession,
  resolveViewScope,
  unauthorized,
  forbidden,
} from "@/lib/auth";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
});

function cookieRequest(url: string, cookieValue?: string): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-request-id": "test-req-id",
  };
  if (cookieValue) {
    headers["Cookie"] = `${SESSION_COOKIE_NAME}=${cookieValue}`;
  }
  return new NextRequest(url, { method: "GET", headers });
}

// ─── getRequestUser ────────────────────────────────────────────────────────

describe("getRequestUser", () => {
  it("returns null when no auth", async () => {
    const req = anonRequest("http://localhost/", { method: "GET" });
    const u = await getRequestUser(req);
    expect(u).toBeNull();
  });

  it("returns user via valid Bearer token", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: user.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const u = await getRequestUser(req);
    expect(u?.email).toBe("a@example.com");
  });

  it("returns null for unknown bearer", async () => {
    const req = authedRequest("http://localhost/", {
      method: "GET",
      token: "ao_unknown",
    });
    const u = await getRequestUser(req);
    expect(u).toBeNull();
  });

  it("returns user via valid cookie", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/", session.id);
    const u = await getRequestUser(req);
    expect(u?.email).toBe("a@example.com");
  });

  it("returns null for unknown cookie", async () => {
    const req = cookieRequest("http://localhost/", "as_unknown");
    const u = await getRequestUser(req);
    expect(u).toBeNull();
  });
});

// ─── requireUser / requireBearerUser / requireAdmin ───────────────────────

describe("requireUser", () => {
  it("returns 401 with requestId when no auth", async () => {
    const req = anonRequest("http://localhost/", { method: "GET" });
    const r = await requireUser(req);
    expect(r).toBeInstanceOf(NextResponse);
    const body = (await (r as NextResponse).json()) as { error?: string; requestId?: string };
    expect(body.error).toBe("Unauthorized");
    expect(body.requestId).toBe("test-req-id");
  });

  it("returns the user when authenticated", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: user.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireUser(req);
    expect(r).not.toBeInstanceOf(NextResponse);
    expect((r as { email: string }).email).toBe("a@example.com");
  });
});

describe("requireBearerUser", () => {
  it("rejects cookie-only auth (no Bearer header)", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/", session.id);
    const r = await requireBearerUser(req);
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(401);
  });

  it("accepts valid Bearer token", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: user.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireBearerUser(req);
    expect((r as { email: string }).email).toBe("a@example.com");
  });

  it("rejects empty bearer", async () => {
    const req = new NextRequest("http://localhost/", {
      method: "GET",
      headers: { Authorization: "Bearer ", "x-request-id": "rid" },
    });
    const r = await requireBearerUser(req);
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(401);
  });
});

describe("requireAdmin", () => {
  it("403s a member", async () => {
    // Insert a placeholder first user so the first-user-is-admin rule
    // doesn't auto-promote our test "member" to admin.
    insertUser(db, { email: "first@example.com", password: "p" });
    const member = insertUser(db, {
      email: "m@example.com",
      password: "p",
      role: "member",
    });
    const { raw } = issueApiToken(db, { userId: member.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireAdmin(req);
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(403);
  });

  it("allows an admin", async () => {
    insertUser(db, { email: "first@example.com", password: "p" }); // make next non-first
    const admin = insertUser(db, {
      email: "admin@example.com",
      password: "p",
      role: "admin",
    });
    const { raw } = issueApiToken(db, { userId: admin.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireAdmin(req);
    expect((r as { role: string }).role).toBe("admin");
  });
});

// ─── requireOwnedRun ──────────────────────────────────────────────────────

describe("requireOwnedRun", () => {
  function seedRun(ownerId: string) {
    const base = startRun(
      createRun(
        { humanReadable: "x", structured: { type: "x", description: "x", parameters: {} } },
        { repo: "r", branch: "b", permissions: [], sandbox: { enabled: false, isolationLevel: "n" } },
      ),
    );
    const run = { ...base, userId: ownerId };
    insertRun(db, run);
    return run.id as string;
  }

  it("401 on missing bearer", async () => {
    const req = anonRequest("http://localhost/", { method: "GET" });
    const r = await requireOwnedRun(req, "nonexistent");
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(401);
  });

  it("404 on missing run", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: user.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireOwnedRun(req, "missing_id");
    expect((r as NextResponse).status).toBe(404);
  });

  it("returns {user, run} when caller owns it", async () => {
    const owner = insertUser(db, { email: "owner@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: owner.id, name: "t" });
    const runId = seedRun(owner.id);

    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireOwnedRun(req, runId);
    expect(r).not.toBeInstanceOf(NextResponse);
    expect((r as { user: { id: string } }).user.id).toBe(owner.id);
  });

  it("404 (not 403) when caller is a member and doesn't own the run", async () => {
    const owner = insertUser(db, { email: "owner@example.com", password: "p" });
    const runId = seedRun(owner.id);

    const other = insertUser(db, { email: "other@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: other.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });

    const r = await requireOwnedRun(req, runId);
    expect((r as NextResponse).status).toBe(404);
  });

  it("admin can access any user's run", async () => {
    const owner = insertUser(db, { email: "owner@example.com", password: "p" });
    const runId = seedRun(owner.id);

    // Force admin role (not first user).
    const admin = insertUser(db, {
      email: "admin@example.com",
      password: "p",
      role: "admin",
    });
    const { raw } = issueApiToken(db, { userId: admin.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });

    const r = await requireOwnedRun(req, runId);
    expect(r).not.toBeInstanceOf(NextResponse);
    expect((r as { run: { id: string } }).run.id).toBe(runId);
  });
});

// ─── requireOwnedSession ──────────────────────────────────────────────────

describe("requireOwnedSession", () => {
  function seedSession(ownerId: string) {
    const session = activateSession(createSession("agent", {}));
    const tagged = { ...session, userId: ownerId };
    insertSession(db, tagged);
    return tagged.id as string;
  }

  it("404 (not 403) when member doesn't own the session", async () => {
    const owner = insertUser(db, { email: "owner@example.com", password: "p" });
    const sessId = seedSession(owner.id);

    const other = insertUser(db, { email: "other@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: other.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireOwnedSession(req, sessId);
    expect((r as NextResponse).status).toBe(404);
  });

  it("admin sees any session", async () => {
    const owner = insertUser(db, { email: "owner@example.com", password: "p" });
    const sessId = seedSession(owner.id);

    const admin = insertUser(db, {
      email: "admin@example.com",
      password: "p",
      role: "admin",
    });
    const { raw } = issueApiToken(db, { userId: admin.id, name: "t" });
    const req = authedRequest("http://localhost/", { method: "GET", token: raw });
    const r = await requireOwnedSession(req, sessId);
    expect((r as { session: { id: string } }).session.id).toBe(sessId);
  });
});

// ─── resolveViewScope ─────────────────────────────────────────────────────

describe("resolveViewScope", () => {
  const member = {
    id: "u_member",
    email: "m@example.com",
    name: null,
    role: "member",
    mustChangePassword: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const admin = {
    id: "u_admin",
    email: "a@example.com",
    name: null,
    role: "admin",
    mustChangePassword: false,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("member is always scoped to own runs, can't toggle", () => {
    const s = resolveViewScope(member, {});
    expect(s.userId).toBe("u_member");
    expect(s.active).toBe("mine");
    expect(s.canToggle).toBe(false);
  });

  it("member ignores ?view=team", () => {
    const s = resolveViewScope(member, { view: "team" });
    expect(s.userId).toBe("u_member");
    expect(s.active).toBe("mine");
  });

  it("admin defaults to team view (no filter)", () => {
    const s = resolveViewScope(admin, {});
    expect(s.userId).toBeUndefined();
    expect(s.active).toBe("team");
    expect(s.canToggle).toBe(true);
  });

  it("admin opts into self-scoping via ?view=mine", () => {
    const s = resolveViewScope(admin, { view: "mine" });
    expect(s.userId).toBe("u_admin");
    expect(s.active).toBe("mine");
    expect(s.canToggle).toBe(true);
  });

  it("works with URLSearchParams as well as plain objects", () => {
    const params = new URLSearchParams("view=mine");
    const s = resolveViewScope(admin, params);
    expect(s.userId).toBe("u_admin");
    expect(s.active).toBe("mine");
  });

  it("admin scoping by ?userId=<other-id> selects that user", () => {
    const s = resolveViewScope(admin, { userId: "u_someone_else" });
    expect(s.userId).toBe("u_someone_else");
    expect(s.active).toBe("user");
    expect(s.canToggle).toBe(true);
  });

  it("admin scoping by ?userId=<own-id> normalizes to 'mine'", () => {
    const s = resolveViewScope(admin, { userId: "u_admin" });
    expect(s.userId).toBe("u_admin");
    expect(s.active).toBe("mine");
  });

  it("?userId wins over ?view=mine when both are present", () => {
    const s = resolveViewScope(admin, {
      view: "mine",
      userId: "u_other",
    });
    expect(s.userId).toBe("u_other");
    expect(s.active).toBe("user");
  });

  it("member ignores ?userId=<other-id> (still self-scoped)", () => {
    const s = resolveViewScope(member, { userId: "u_someone_else" });
    expect(s.userId).toBe("u_member");
    expect(s.active).toBe("mine");
    expect(s.canToggle).toBe(false);
  });
});

// ─── unauthorized / forbidden response helpers ─────────────────────────────

describe("response helpers", () => {
  it("unauthorized includes requestId from the request", async () => {
    const req = anonRequest("http://localhost/", { method: "GET" });
    const res = unauthorized("nope", req);
    const body = (await res.json()) as { error?: string; requestId?: string };
    expect(res.status).toBe(401);
    expect(body.error).toBe("nope");
    expect(body.requestId).toBe("test-req-id");
  });

  it("forbidden omits requestId when no request passed", async () => {
    const res = forbidden("blocked");
    const body = (await res.json()) as { error?: string; requestId?: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe("blocked");
    expect(body.requestId).toBeUndefined();
  });
});
