import { describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";
import { type AgentOpsDb } from "@agentops/db";
import { makeMemoryDb, anonRequest, withParams, jsonOf } from "@/__tests__/_helpers";

// The CSRF guard (checkSameOrigin) runs as the FIRST statement in every
// cookie-auth mutation handler — before auth, params, or body parsing — so a
// cross-origin request is rejected with 403 without touching the DB. These
// tests assert that rollout uniformly across every guarded route.

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

vi.mock("@/lib/db", () => ({ db: () => getTestDb() }));
// db() is never reached on the 403 path (guard returns first) and not reached
// on the same-origin path either (auth short-circuits at 401 with no creds),
// but wire a real memory DB so any lazy access can't throw.
setTestDb(makeMemoryDb());

// Route imports must come AFTER vi.mock.
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as changePasswordPOST } from "@/app/api/auth/change-password/route";
import { POST as deviceApprovePOST } from "@/app/api/auth/device/approve/route";
import { POST as policiesPOST } from "@/app/api/policies/route";
import {
  PATCH as policyPATCH,
  PUT as policyPUT,
  DELETE as policyDELETE,
} from "@/app/api/policies/[id]/route";
import { POST as loadStartersPOST } from "@/app/api/policies/load-starters/route";
import { POST as webhooksPOST } from "@/app/api/webhooks/route";
import {
  PATCH as webhookPATCH,
  DELETE as webhookDELETE,
} from "@/app/api/webhooks/[id]/route";
import { POST as webhookTestPOST } from "@/app/api/webhooks/[id]/test/route";
import { DELETE as tokenDELETE } from "@/app/api/tokens/[id]/route";
import { POST as userPOST } from "@/app/api/users/route";
import {
  PUT as budgetPUT,
  DELETE as budgetDELETE,
} from "@/app/api/budgets/[userId]/route";
import { POST as decidePOST } from "@/app/api/runs/[id]/decide/route";
import { PATCH as sessionPATCH } from "@/app/api/sessions/[id]/route";

interface GuardedRoute {
  readonly name: string;
  readonly method: string;
  readonly url: string;
  readonly invoke: (req: NextRequest) => Promise<Response>;
}

const ROUTES: readonly GuardedRoute[] = [
  { name: "login", method: "POST", url: "http://localhost/api/auth/login", invoke: (r) => loginPOST(r) },
  { name: "logout", method: "POST", url: "http://localhost/api/auth/logout", invoke: (r) => logoutPOST(r) },
  // Guard pre-existed on main for these two; covered here so this file is the
  // single source of truth for cross-origin rejection on every cookie-auth
  // mutation route, and a future removal of either guard is caught.
  { name: "change-password", method: "POST", url: "http://localhost/api/auth/change-password", invoke: (r) => changePasswordPOST(r) },
  { name: "device approve", method: "POST", url: "http://localhost/api/auth/device/approve", invoke: (r) => deviceApprovePOST(r) },
  { name: "policies create", method: "POST", url: "http://localhost/api/policies", invoke: (r) => policiesPOST(r) },
  { name: "policy patch", method: "PATCH", url: "http://localhost/api/policies/p1", invoke: (r) => policyPATCH(r, withParams({ id: "p1" })) },
  { name: "policy put", method: "PUT", url: "http://localhost/api/policies/p1", invoke: (r) => policyPUT(r, withParams({ id: "p1" })) },
  { name: "policy delete", method: "DELETE", url: "http://localhost/api/policies/p1", invoke: (r) => policyDELETE(r, withParams({ id: "p1" })) },
  { name: "load-starters", method: "POST", url: "http://localhost/api/policies/load-starters", invoke: (r) => loadStartersPOST(r) },
  { name: "webhooks create", method: "POST", url: "http://localhost/api/webhooks", invoke: (r) => webhooksPOST(r) },
  { name: "webhook patch", method: "PATCH", url: "http://localhost/api/webhooks/wh1", invoke: (r) => webhookPATCH(r, withParams({ id: "wh1" })) },
  { name: "webhook delete", method: "DELETE", url: "http://localhost/api/webhooks/wh1", invoke: (r) => webhookDELETE(r, withParams({ id: "wh1" })) },
  { name: "webhook test", method: "POST", url: "http://localhost/api/webhooks/wh1/test", invoke: (r) => webhookTestPOST(r, withParams({ id: "wh1" })) },
  { name: "token revoke", method: "DELETE", url: "http://localhost/api/tokens/tok1", invoke: (r) => tokenDELETE(r, withParams({ id: "tok1" })) },
  { name: "user invite", method: "POST", url: "http://localhost/api/users", invoke: (r) => userPOST(r) },
  { name: "budget put", method: "PUT", url: "http://localhost/api/budgets/u1", invoke: (r) => budgetPUT(r, withParams({ userId: "u1" })) },
  { name: "budget delete", method: "DELETE", url: "http://localhost/api/budgets/u1", invoke: (r) => budgetDELETE(r, withParams({ userId: "u1" })) },
  { name: "run decide", method: "POST", url: "http://localhost/api/runs/run1/decide", invoke: (r) => decidePOST(r, withParams({ id: "run1" })) },
  { name: "session patch", method: "PATCH", url: "http://localhost/api/sessions/sess1", invoke: (r) => sessionPATCH(r, withParams({ id: "sess1" })) },
];

describe("CSRF same-origin guard rollout", () => {
  for (const route of ROUTES) {
    it(`403s a cross-origin ${route.method} to ${route.name}`, async () => {
      const req = anonRequest(route.url, {
        method: route.method,
        headers: { Origin: "https://attacker.example", Host: "localhost:3000" },
        body: {},
      });
      const res = await route.invoke(req);
      expect(res.status).toBe(403);
      const body = (await jsonOf(res)) as { error?: string };
      expect(body.error ?? "").toMatch(/cross-origin/i);
    });

    it(`lets a same-origin ${route.method} to ${route.name} past the guard`, async () => {
      // Origin host matches Host → guard passes; the handler then short-circuits
      // on missing credentials/body. The only thing asserted here is that the
      // CSRF guard itself did NOT block it (no 403).
      const req = anonRequest(route.url, {
        method: route.method,
        headers: { Origin: "http://localhost:3000", Host: "localhost:3000" },
        body: {},
      });
      const res = await route.invoke(req);
      expect(res.status).not.toBe(403);
    });

    it(`lets an Origin-less ${route.method} to ${route.name} past the guard`, async () => {
      // CLI/SDK/server callers (and same-origin navigations) omit Origin; the
      // guard must pass these through rather than blocking them.
      const req = anonRequest(route.url, { method: route.method, body: {} });
      const res = await route.invoke(req);
      expect(res.status).not.toBe(403);
    });
  }
});
