// Shared test helpers for dashboard route handler tests.
//
// vi.mock("@/lib/db", ...) is per-file (vi.mock is hoisted). Each test
// file pairs that mock with the hoisted getter/setter pattern here:
//
//   const { getTestDb, setTestDb } = vi.hoisted(...);
//   vi.mock("@/lib/db", () => ({ db: () => getTestDb() }));
//   beforeEach(() => setTestDb(getDb(":memory:")));
//
// This file re-exports user/token helpers and request builders that the
// route tests use after the mock is in place.

import { NextRequest } from "next/server";
import {
  getDb,
  insertUser,
  issueApiToken,
  type AgentOpsDb,
  type User,
} from "@agentops/db";

export function makeMemoryDb(): AgentOpsDb {
  return getDb(":memory:");
}

export interface TestUser {
  readonly user: User;
  readonly token: string;
}

export function createUser(
  db: AgentOpsDb,
  args: { email: string; role?: "admin" | "member"; password?: string } = { email: "test@example.com" },
): TestUser {
  const user = insertUser(db, {
    email: args.email,
    password: args.password ?? "test-password-12345",
    role: args.role ?? "member",
  });
  const { raw } = issueApiToken(db, { userId: user.id, name: "test-token" });
  return { user, token: raw };
}

// Construct a NextRequest with a Bearer token, JSON body, and an
// x-request-id header. Mirrors the proxy's downstream-headers setup.
export function authedRequest(
  url: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    requestId?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-request-id": init.requestId ?? "test-req-id",
    ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    ...(init.headers ?? {}),
  };
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

// Same but unauthenticated.
export function anonRequest(
  url: string,
  init: { method?: string; body?: unknown; requestId?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-request-id": init.requestId ?? "test-req-id",
    ...(init.headers ?? {}),
  };
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

export async function jsonOf(res: Response): Promise<unknown> {
  return res.json();
}

// Wrap a Next-style route handler's params arg.
export function withParams<P extends Record<string, string>>(
  params: P,
): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}
