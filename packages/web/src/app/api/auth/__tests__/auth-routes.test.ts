import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertUser,
  createAuthSession,
  getUserByEmail,
  getUserWithPasswordByEmail,
  verifyPassword,
  type AgentOpsDb,
} from "@agentops/db";
import { makeMemoryDb, anonRequest, authedRequest, jsonOf } from "@/__tests__/_helpers";
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
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { POST as deviceInitRoute } from "@/app/api/auth/device/route";
import { POST as deviceTokenRoute } from "@/app/api/auth/device/token/route";
import { POST as deviceApproveRoute } from "@/app/api/auth/device/approve/route";
import { POST as inviteUserRoute } from "@/app/api/users/route";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
});

// Helper: extract the Set-Cookie value for the session cookie.
function extractSessionCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const m = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  return m && m[1] ? m[1] : null;
}

// Helper: build a request with a session cookie attached.
function cookieRequest(
  url: string,
  init: {
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-request-id": "test-req-id",
    ...(init.cookie ? { Cookie: `${SESSION_COOKIE_NAME}=${init.cookie}` } : {}),
    ...(init.headers ?? {}),
  };
  // Use NextRequest directly so cookies flow.
  // (NextRequest reads from the request's headers.)
  const { NextRequest } = require("next/server");
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  it("400 on missing email or password", async () => {
    const req = anonRequest("http://localhost/api/auth/login", { body: {} });
    const res = await loginRoute(req);
    expect(res.status).toBe(400);
  });

  it("401 on unknown email (generic message — no enumeration)", async () => {
    const req = anonRequest("http://localhost/api/auth/login", {
      body: { email: "nobody@example.com", password: "anything" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("Invalid credentials");
  });

  it("401 on wrong password (same message as unknown email)", async () => {
    insertUser(db, { email: "alice@example.com", password: "correct" });
    const req = anonRequest("http://localhost/api/auth/login", {
      body: { email: "alice@example.com", password: "wrong" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("Invalid credentials");
  });

  it("200 with set-cookie + user body on valid credentials", async () => {
    const user = insertUser(db, {
      email: "alice@example.com",
      password: "hunter2",
      role: "admin",
      mustChangePassword: true,
    });
    const req = anonRequest("http://localhost/api/auth/login", {
      body: { email: "alice@example.com", password: "hunter2" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(200);

    const body = (await jsonOf(res)) as {
      user?: { email: string; role: string; mustChangePassword: boolean };
    };
    expect(body.user?.email).toBe("alice@example.com");
    expect(body.user?.role).toBe("admin");
    expect(body.user?.mustChangePassword).toBe(true);

    const cookie = extractSessionCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie!.startsWith("as_")).toBe(true);
  });

  it("email lookup is case-insensitive", async () => {
    insertUser(db, { email: "alice@example.com", password: "p" });
    const req = anonRequest("http://localhost/api/auth/login", {
      body: { email: "ALICE@example.COM", password: "p" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(200);
  });

  it("sets a Secure session cookie behind a TLS-terminating proxy (x-forwarded-proto=https)", async () => {
    insertUser(db, { email: "proxy@example.com", password: "hunter2" });
    const req = cookieRequest("http://localhost/api/auth/login", {
      body: { email: "proxy@example.com", password: "hunter2" },
      headers: { "x-forwarded-proto": "https" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/;\s*Secure/i);
  });

  it("omits Secure for plain-http dev (no proxy, not production)", async () => {
    insertUser(db, { email: "dev@example.com", password: "hunter2" });
    const req = cookieRequest("http://localhost/api/auth/login", {
      body: { email: "dev@example.com", password: "hunter2" },
    });
    const res = await loginRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/;\s*Secure/i);
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────

describe("POST /api/auth/logout", () => {
  it("clears the cookie and removes server-side session", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);

    const req = cookieRequest("http://localhost/api/auth/logout", {
      cookie: session.id,
    });
    const res = await logoutRoute(req);
    expect(res.status).toBe(200);

    // Set-Cookie should clear the session cookie. NextResponse.cookies.delete
    // expresses this as an empty value + past Expires date (Unix epoch); other
    // libs use Max-Age=0. Accept either.
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toBeTruthy();
    const lower = setCookie.toLowerCase();
    const cleared =
      lower.includes("max-age=0") ||
      lower.includes("expires=thu, 01 jan 1970") ||
      lower.includes(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toBe(true);

    // Server-side session row should be gone.
    const { getUserBySessionId } = await import("@agentops/db");
    expect(getUserBySessionId(db, session.id)).toBeNull();
  });

  it("works even with no cookie present", async () => {
    const req = anonRequest("http://localhost/api/auth/logout", { body: {} });
    const res = await logoutRoute(req);
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("returns user when a valid cookie is sent", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);

    const req = cookieRequest("http://localhost/api/auth/me", {
      method: "GET",
      cookie: session.id,
    });
    const res = await meRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { user?: { email: string } | null };
    expect(body.user?.email).toBe("a@example.com");
  });

  it("returns user=null with 200 when no credential present", async () => {
    const req = anonRequest("http://localhost/api/auth/me", { method: "GET" });
    const res = await meRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { user?: unknown };
    expect(body.user).toBeNull();
  });

  it("accepts Bearer token in addition to cookie", async () => {
    const { issueApiToken } = await import("@agentops/db");
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const { raw } = issueApiToken(db, { userId: user.id, name: "test" });

    const req = authedRequest("http://localhost/api/auth/me", {
      method: "GET",
      token: raw,
    });
    const res = await meRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as { user?: { email?: string } };
    expect(body.user?.email).toBe("a@example.com");
  });
});

// ─── POST /api/auth/change-password ───────────────────────────────────────

describe("POST /api/auth/change-password", () => {
  it("401 without auth", async () => {
    const req = anonRequest("http://localhost/api/auth/change-password", {
      body: { currentPassword: "x", newPassword: "y" },
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(401);
  });

  it("400 on missing fields", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/change-password", {
      cookie: session.id,
      body: {},
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(400);
  });

  it("400 if new password is too short", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "current123" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/change-password", {
      cookie: session.id,
      body: { currentPassword: "current123", newPassword: "short" },
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(400);
  });

  it("401 if current password is wrong", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "actual" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/change-password", {
      cookie: session.id,
      body: { currentPassword: "wrong", newPassword: "newpassword123" },
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(401);
  });

  it("400 if new password equals current", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "samepass1234" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/change-password", {
      cookie: session.id,
      body: { currentPassword: "samepass1234", newPassword: "samepass1234" },
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(400);
  });

  it("200 + mustChangePassword cleared on success", async () => {
    const user = insertUser(db, {
      email: "a@example.com",
      password: "oldpass1234",
      mustChangePassword: true,
    });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/change-password", {
      cookie: session.id,
      body: { currentPassword: "oldpass1234", newPassword: "newpass1234" },
    });
    const res = await changePasswordRoute(req);
    expect(res.status).toBe(200);

    const after = getUserWithPasswordByEmail(db, "a@example.com")!;
    expect(verifyPassword("newpass1234", after.passwordHash)).toBe(true);
    expect(verifyPassword("oldpass1234", after.passwordHash)).toBe(false);
    expect(after.user.mustChangePassword).toBe(false);
  });
});

// ─── POST /api/auth/device (initiate) ─────────────────────────────────────

describe("POST /api/auth/device (initiate)", () => {
  it("returns device_code + user_code + verification URLs (public, no auth)", async () => {
    const req = anonRequest("http://localhost/api/auth/device", { body: {} });
    const res = await deviceInitRoute(req);
    expect(res.status).toBe(200);
    const body = (await jsonOf(res)) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
    };
    expect(body.device_code).toMatch(/^dc_/);
    expect(body.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.verification_uri).toContain("/auth/device");
    expect(body.verification_uri_complete).toContain(body.user_code!);
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.interval).toBeGreaterThan(0);
  });
});

// ─── POST /api/auth/device/token (poll) ───────────────────────────────────

describe("POST /api/auth/device/token (poll)", () => {
  async function newDeviceCode() {
    const initRes = await deviceInitRoute(
      anonRequest("http://localhost/api/auth/device", { body: {} }),
    );
    const body = (await jsonOf(initRes)) as {
      device_code: string;
      user_code: string;
    };
    return body;
  }

  it("authorization_pending while not yet approved", async () => {
    const { device_code } = await newDeviceCode();
    const req = anonRequest("http://localhost/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code,
      },
    });
    const res = await deviceTokenRoute(req);
    expect(res.status).toBe(400);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("authorization_pending");
  });

  it("unsupported_grant_type on bad grant", async () => {
    const req = anonRequest("http://localhost/api/auth/device/token", {
      body: { grant_type: "password", device_code: "x" },
    });
    const res = await deviceTokenRoute(req);
    expect(res.status).toBe(400);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("unsupported_grant_type");
  });

  it("invalid_request when device_code missing", async () => {
    const req = anonRequest("http://localhost/api/auth/device/token", {
      body: { grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    });
    const res = await deviceTokenRoute(req);
    expect(res.status).toBe(400);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("invalid_grant on unknown device_code", async () => {
    const req = anonRequest("http://localhost/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: "dc_does_not_exist",
      },
    });
    const res = await deviceTokenRoute(req);
    expect(res.status).toBe(400);
    const body = (await jsonOf(res)) as { error?: string };
    expect(body.error).toBe("invalid_grant");
  });

  it("returns access_token once after approval; second poll fails", async () => {
    const user = insertUser(db, { email: "approver@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const code = await newDeviceCode();

    // Approve via the dashboard route.
    const approveReq = cookieRequest(
      "http://localhost/api/auth/device/approve",
      {
        cookie: session.id,
        body: { user_code: code.user_code, action: "approve" },
      },
    );
    const approveRes = await deviceApproveRoute(approveReq);
    expect(approveRes.status).toBe(200);

    // Poll: receives access_token.
    const pollReq = anonRequest("http://localhost/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
      },
    });
    const pollRes = await deviceTokenRoute(pollReq);
    expect(pollRes.status).toBe(200);
    const body = (await jsonOf(pollRes)) as {
      access_token?: string;
      token_type?: string;
    };
    expect(body.access_token).toMatch(/^ao_/);
    expect(body.token_type).toBe("Bearer");

    // Second poll: invalid_grant (consumed).
    const pollReq2 = anonRequest("http://localhost/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
      },
    });
    const pollRes2 = await deviceTokenRoute(pollReq2);
    expect(pollRes2.status).toBe(400);
    const body2 = (await jsonOf(pollRes2)) as { error?: string };
    expect(body2.error).toBe("invalid_grant");
  });

  it("access_denied after a deny action", async () => {
    const user = insertUser(db, { email: "denier@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const code = await newDeviceCode();

    const denyReq = cookieRequest("http://localhost/api/auth/device/approve", {
      cookie: session.id,
      body: { user_code: code.user_code, action: "deny" },
    });
    await deviceApproveRoute(denyReq);

    const pollReq = anonRequest("http://localhost/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.device_code,
      },
    });
    const pollRes = await deviceTokenRoute(pollReq);
    expect(pollRes.status).toBe(400);
    const body = (await jsonOf(pollRes)) as { error?: string };
    expect(body.error).toBe("access_denied");
  });
});

// ─── POST /api/auth/device/approve ────────────────────────────────────────

describe("POST /api/auth/device/approve", () => {
  it("401 without auth", async () => {
    const req = anonRequest("http://localhost/api/auth/device/approve", {
      body: { user_code: "ABCD-1234" },
    });
    const res = await deviceApproveRoute(req);
    expect(res.status).toBe(401);
  });

  it("404 on unknown user_code", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/device/approve", {
      cookie: session.id,
      body: { user_code: "XXXX-XXXX" },
    });
    const res = await deviceApproveRoute(req);
    expect(res.status).toBe(404);
  });

  it("400 on missing user_code", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const req = cookieRequest("http://localhost/api/auth/device/approve", {
      cookie: session.id,
      body: {},
    });
    const res = await deviceApproveRoute(req);
    expect(res.status).toBe(400);
  });

  it("409 when re-approving an already-approved code", async () => {
    const user = insertUser(db, { email: "a@example.com", password: "p" });
    const session = createAuthSession(db, user.id);
    const code = await (async () => {
      const r = await deviceInitRoute(
        anonRequest("http://localhost/api/auth/device", { body: {} }),
      );
      return (await jsonOf(r)) as { user_code: string };
    })();

    // First approve succeeds.
    await deviceApproveRoute(
      cookieRequest("http://localhost/api/auth/device/approve", {
        cookie: session.id,
        body: { user_code: code.user_code, action: "approve" },
      }),
    );
    // Second approve sees status="approved" and rejects.
    const res = await deviceApproveRoute(
      cookieRequest("http://localhost/api/auth/device/approve", {
        cookie: session.id,
        body: { user_code: code.user_code, action: "approve" },
      }),
    );
    expect(res.status).toBe(409);
  });
});

// ─── POST /api/users (invite) — B7 ────────────────────────────────────────

describe("POST /api/users (invite)", () => {
  function seedAdmin(): { sessionId: string } {
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

  function seedMember(): { sessionId: string } {
    insertUser(db, {
      email: "admin@acme.com",
      name: "Admin",
      password: "x",
      role: "admin",
      mustChangePassword: false,
    });
    const u = insertUser(db, {
      email: "member@acme.com",
      name: "Member",
      password: "x",
      role: "member",
      mustChangePassword: false,
    });
    const session = createAuthSession(db, u.id);
    return { sessionId: session.id };
  }

  it("admin creates a user and gets back a one-time temp password", async () => {
    const { sessionId } = seedAdmin();
    const req = cookieRequest("http://localhost/api/users", {
      cookie: sessionId,
      body: { email: "new@acme.com", name: "New User", role: "member" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(201);
    const body = (await jsonOf(res)) as {
      user: { email: string; role: string };
      tempPassword: string;
    };
    expect(body.user.email).toBe("new@acme.com");
    expect(body.user.role).toBe("member");
    expect(body.tempPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    // New user can sign in with that temp password.
    const u = getUserWithPasswordByEmail(db, "new@acme.com");
    expect(u).not.toBeNull();
    expect(verifyPassword(body.tempPassword, u!.passwordHash)).toBe(true);
  });

  it("non-admin gets 403", async () => {
    const { sessionId } = seedMember();
    const req = cookieRequest("http://localhost/api/users", {
      cookie: sessionId,
      body: { email: "new@acme.com" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(403);
  });

  it("409 on duplicate email", async () => {
    const { sessionId } = seedAdmin();
    const req1 = cookieRequest("http://localhost/api/users", {
      cookie: sessionId,
      body: { email: "dup@acme.com" },
    });
    await inviteUserRoute(req1);
    const req2 = cookieRequest("http://localhost/api/users", {
      cookie: sessionId,
      body: { email: "dup@acme.com" },
    });
    const res = await inviteUserRoute(req2);
    expect(res.status).toBe(409);
  });

  it("400 on malformed email", async () => {
    const { sessionId } = seedAdmin();
    const req = cookieRequest("http://localhost/api/users", {
      cookie: sessionId,
      body: { email: "not-an-email" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(400);
  });

  it("unauthenticated returns 401", async () => {
    const req = anonRequest("http://localhost/api/users", {
      body: { email: "x@y.com" },
    });
    const res = await inviteUserRoute(req);
    expect(res.status).toBe(401);
  });
});
