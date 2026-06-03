import { describe, it, expect, beforeEach, vi } from "vitest";
import { insertRun, insertEvent, type AgentOpsDb } from "@agentops/db";
import {
  createRun,
  startRun,
  createRunId,
  createEvent,
  EventCategory,
  EVENT_TYPES,
  type Run,
} from "@agentops/core";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  anonRequest,
  jsonOf,
  type TestUser,
} from "@/__tests__/_helpers";

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

import { GET as statsRoute } from "@/app/api/stats/route";

let db: AgentOpsDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;

function seedRunWithEvent(userId: string): void {
  const r = startRun(
    createRun(
      { humanReadable: "t", structured: { type: "t", description: "t", parameters: {} } },
      { repo: "acme/x", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    ),
  );
  const run: Run = { ...r, id: createRunId(`run_${Math.random().toString(36).slice(2, 10)}`), userId };
  insertRun(db, run);
  // An event sourced from that run (so resolveOwnedSourceIds(userId) covers it).
  insertEvent(db, createEvent(EventCategory.Policy, EVENT_TYPES["policy.violated"], run.id as string, { runId: run.id }));
}

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  admin = createUser(db, { email: "admin@example.com", role: "admin" });
  alice = createUser(db, { email: "alice@example.com", role: "member" });
  bob = createUser(db, { email: "bob@example.com", role: "member" });
  seedRunWithEvent(alice.user.id);
  seedRunWithEvent(bob.user.id);
});

describe("GET /api/stats event-count scoping (#12)", () => {
  const statsFor = (token: string, query = "") =>
    statsRoute(authedRequest(`http://localhost/api/stats${query}`, { method: "GET", token }));

  it("401 without auth", async () => {
    expect((await statsRoute(anonRequest("http://localhost/api/stats", { method: "GET" }))).status).toBe(401);
  });

  it("admin team view counts events across all users", async () => {
    const res = await statsFor(admin.token);
    const body = (await jsonOf(res)) as { events: { last24h: number } };
    expect(body.events.last24h).toBe(2);
  });

  it("admin scoped to one user sees only that user's event count", async () => {
    const res = await statsFor(admin.token, `?userId=${alice.user.id}`);
    const body = (await jsonOf(res)) as { events: { last24h: number } };
    expect(body.events.last24h).toBe(1);
  });

  it("a member only ever sees their own event count", async () => {
    const res = await statsFor(bob.token);
    const body = (await jsonOf(res)) as { events: { last24h: number } };
    expect(body.events.last24h).toBe(1);
  });
});
