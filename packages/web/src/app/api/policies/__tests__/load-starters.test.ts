import { describe, it, expect, beforeEach, vi } from "vitest";
import { listPolicies, STARTER_POLICIES, type AgentOpsDb } from "@agentops/db";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  anonRequest,
  jsonOf,
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

vi.mock("@/lib/db", () => ({
  db: () => getTestDb(),
}));

// Route import must come AFTER vi.mock.
import { POST as loadStartersRoute } from "@/app/api/policies/load-starters/route";

let db: AgentOpsDb;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
});

describe("POST /api/policies/load-starters", () => {
  it("requires authentication", async () => {
    const req = anonRequest("http://localhost/api/policies/load-starters");
    const res = await loadStartersRoute(req);
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members", async () => {
    const { token } = createUser(db, { email: "member@example.com", role: "member" });
    const req = authedRequest("http://localhost/api/policies/load-starters", {
      token,
    });
    const res = await loadStartersRoute(req);
    expect(res.status).toBe(403);

    // And no policies should have been inserted.
    expect(listPolicies(db)).toHaveLength(0);
  });

  it("admin can load starters on an empty DB", async () => {
    const { token } = createUser(db, { email: "admin@example.com", role: "admin" });
    const req = authedRequest("http://localhost/api/policies/load-starters", {
      token,
    });
    const res = await loadStartersRoute(req);
    expect(res.status).toBe(200);

    const body = (await jsonOf(res)) as {
      inserted: string[];
      skipped: string[];
    };
    expect(body.inserted).toHaveLength(STARTER_POLICIES.length);
    expect(body.skipped).toHaveLength(0);

    expect(listPolicies(db)).toHaveLength(STARTER_POLICIES.length);
  });

  it("second call is idempotent: all skipped", async () => {
    const { token } = createUser(db, { email: "admin@example.com", role: "admin" });

    const first = await loadStartersRoute(
      authedRequest("http://localhost/api/policies/load-starters", { token }),
    );
    expect(first.status).toBe(200);

    const second = await loadStartersRoute(
      authedRequest("http://localhost/api/policies/load-starters", { token }),
    );
    expect(second.status).toBe(200);
    const body = (await jsonOf(second)) as {
      inserted: string[];
      skipped: string[];
    };
    expect(body.inserted).toHaveLength(0);
    expect(body.skipped).toHaveLength(STARTER_POLICIES.length);
  });
});
