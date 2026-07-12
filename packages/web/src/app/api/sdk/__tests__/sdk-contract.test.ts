import { describe, it, expect, beforeEach, vi } from "vitest";
import { insertRun, insertPolicy, type AgentOpsDb } from "@agentops/db";
import {
  createRun,
  startRun,
  createPolicyId,
  PolicyType,
  PolicySeverity,
  type Run,
} from "@agentops/core";
import {
  makeMemoryDb,
  createUser,
  authedRequest,
  jsonOf,
  withParams,
  type TestUser,
} from "@/__tests__/_helpers";

// Contract test: drive the REAL /api/sdk/* handlers and assert each response
// body matches the shape declared by @agentops/sdk's response types (see
// packages/sdk/src/types.ts — the SOURCE OF TRUTH this guards). The SDK client
// casts responses to those types with no runtime validation, so the routes
// must actually produce them. We assert exact keys + value types here because
// a TS type can't be checked structurally at runtime. If you change a shape on
// either side, update both and this test.

const { getTestDb, setTestDb, dispatchWebhookEvent } = vi.hoisted(() => {
  let _db: AgentOpsDb | null = null;
  return {
    getTestDb: () => {
      if (!_db) throw new Error("Test DB not set");
      return _db;
    },
    setTestDb: (db: AgentOpsDb) => {
      _db = db;
    },
    dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/db", () => ({ db: () => getTestDb() }));
vi.mock("@/lib/webhook-dispatcher", () => ({ dispatchWebhookEvent }));

import { POST as createSessionRoute } from "@/app/api/sdk/sessions/route";
import { POST as createRunRoute } from "@/app/api/sdk/runs/route";
import { POST as reportActionRoute } from "@/app/api/sdk/runs/[id]/actions/route";
import { POST as reportArtifactRoute } from "@/app/api/sdk/runs/[id]/artifacts/route";
import { POST as reportMetricsRoute } from "@/app/api/sdk/runs/[id]/metrics/route";
import { POST as completeRunRoute } from "@/app/api/sdk/runs/[id]/complete/route";
import { POST as failRunRoute } from "@/app/api/sdk/runs/[id]/fail/route";
import { POST as heartbeatRoute } from "@/app/api/sdk/sessions/[id]/heartbeat/route";
import { POST as terminateSessionRoute } from "@/app/api/sdk/sessions/[id]/terminate/route";
import { POST as policyCheckRoute } from "@/app/api/sdk/policy/check/route";

let db: AgentOpsDb;
let alice: TestUser;

beforeEach(() => {
  db = makeMemoryDb();
  setTestDb(db);
  alice = createUser(db, { email: "alice@example.com" });
});

function seedRun(): string {
  const base = startRun(
    createRun(
      { humanReadable: "t", structured: { type: "t", description: "t", parameters: {} } },
      { repo: "acme/test", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    ),
  );
  const run: Run = { ...base, userId: alice.user.id };
  insertRun(db, run);
  return run.id as string;
}

const reqFor = (path: string, body: unknown) =>
  authedRequest(`http://localhost${path}`, { token: alice.token, body });

const bodyOf = async (res: Response): Promise<Record<string, unknown>> =>
  (await jsonOf(res)) as Record<string, unknown>;

describe("SDK route ⇄ type contract", () => {
  it("createSession → { sessionId, status }  (CreateSessionResponse)", async () => {
    const res = await createSessionRoute(reqFor("/api/sdk/sessions", { agentId: "claude" }));
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["sessionId", "status"]);
    expect(typeof body.sessionId).toBe("string");
    expect(typeof body.status).toBe("string");
  });

  it("startRun → { runId, status }  (StartRunResponse)", async () => {
    const res = await createRunRoute(
      reqFor("/api/sdk/runs", {
        goal: { humanReadable: "t", structured: { type: "t", description: "t", parameters: {} } },
        environment: { repo: "acme/test", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }),
    );
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["runId", "status"]);
    expect(typeof body.runId).toBe("string");
  });

  it("reportAction → { runId, actionId }  (ReportActionResponse)", async () => {
    const runId = seedRun();
    const res = await reportActionRoute(
      reqFor(`/api/sdk/runs/${runId}/actions`, { id: "action_x", toolCalls: [], fileEdits: [], commands: [] }),
      withParams({ id: runId }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["actionId", "runId"]);
    expect(body.runId).toBe(runId);
    expect(typeof body.actionId).toBe("string");
  });

  it("reportArtifact → { runId, artifactId }  (ReportArtifactResponse)", async () => {
    const runId = seedRun();
    const res = await reportArtifactRoute(
      reqFor(`/api/sdk/runs/${runId}/artifacts`, { diffs: ["+x"], logs: [], testOutputs: [], reports: [] }),
      withParams({ id: runId }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["artifactId", "runId"]);
    expect(body.runId).toBe(runId);
    expect(typeof body.artifactId).toBe("string");
  });

  it("reportMetrics → { runId }  (ReportMetricsResponse)", async () => {
    const runId = seedRun();
    const res = await reportMetricsRoute(
      reqFor(`/api/sdk/runs/${runId}/metrics`, { costUsd: 0.1, wallTimeMs: 10, flakeRate: 0 }),
      withParams({ id: runId }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body)).toEqual(["runId"]);
    expect(body.runId).toBe(runId);
  });

  it("completeRun → { runId, score, recommendation, summary }  (CompleteRunResponse)", async () => {
    const runId = seedRun();
    const res = await completeRunRoute(reqFor(`/api/sdk/runs/${runId}/complete`, {}), withParams({ id: runId }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["recommendation", "runId", "score", "summary"]);
    expect(body.runId).toBe(runId);
    expect(typeof body.recommendation).toBe("string");
    expect(body.score).toBeTypeOf("object");
    expect(body.summary).toBeTypeOf("object");
  });

  it("failRun → { ok: true }  (FailRunResponse)", async () => {
    const runId = seedRun();
    const res = await failRunRoute(reqFor(`/api/sdk/runs/${runId}/fail`, { error: "boom" }), withParams({ id: runId }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(body.ok).toBe(true);
  });

  it("heartbeat → { ok: true, commands: [] }  (HeartbeatResponse)", async () => {
    const { insertSession } = await import("@agentops/db");
    const { createSession, activateSession } = await import("@agentops/core");
    const session = { ...activateSession(createSession("agent", {})), userId: alice.user.id };
    insertSession(db, session);
    const res = await heartbeatRoute(
      reqFor(`/api/sdk/sessions/${session.id}/heartbeat`, {}),
      withParams({ id: session.id as string }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["commands", "ok"]);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.commands)).toBe(true);
  });

  it("terminateSession → { status }  (TerminateSessionResponse)", async () => {
    const { insertSession } = await import("@agentops/db");
    const { createSession, activateSession } = await import("@agentops/core");
    const session = { ...activateSession(createSession("agent", {})), userId: alice.user.id };
    insertSession(db, session);
    const res = await terminateSessionRoute(
      reqFor(`/api/sdk/sessions/${session.id}/terminate`, {}),
      withParams({ id: session.id as string }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body)).toEqual(["status"]);
    expect(body.status).toBe("terminated");
  });

  it("policy check (allow) → { decision, violations, warnings }  (CheckPolicyResponse)", async () => {
    const runId = seedRun();
    const res = await policyCheckRoute(reqFor("/api/sdk/policy/check", { runId, toolName: "Read", toolInput: {} }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.decision).toBe("allow");
    // violations must be present (empty) even on allow, per CheckPolicyResponse.
    expect(Array.isArray(body.violations)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it("policy check (block) → { decision: 'block', reason, violations, warnings }", async () => {
    const runId = seedRun();
    // An Error-severity ToolRestriction that blocks "Write" → decision block.
    insertPolicy(db, {
      id: createPolicyId("pol_block_write"),
      name: "No Write",
      type: PolicyType.ToolRestriction,
      config: { type: PolicyType.ToolRestriction, blockedTools: ["Write"] },
      severity: PolicySeverity.Error,
      enabled: true,
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const res = await policyCheckRoute(
      reqFor("/api/sdk/policy/check", { runId, toolName: "Write", toolInput: { file_path: "x.ts", content: "y" } }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.decision).toBe("block");
    expect(typeof body.reason).toBe("string");
    expect(Array.isArray(body.violations)).toBe(true);
    expect((body.violations as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(body.warnings)).toBe(true);
  });
});

// Request-side contract: bodies shaped exactly like the SDK's REQUEST types
// must be consumed by the routes, not silently dropped. This is the drift the
// response-only tests above couldn't see (StartRunRequest.agents was ignored,
// CompleteRunRequest couldn't carry testResults, ReportMetricsRequest
// replaced instead of merged).

describe("SDK request type ⇄ route contract", () => {
  it("StartRunRequest.agents is persisted onto the run", async () => {
    // Body shaped like StartRunRequest, agents included.
    const res = await createRunRoute(
      reqFor("/api/sdk/runs", {
        goal: { humanReadable: "t", structured: { type: "t", description: "t", parameters: {} } },
        agents: [
          { id: "agent-1", model: "claude-opus-4-6", role: "implementer" },
          { id: "agent-2", model: "claude-haiku-4-5", role: "reviewer" },
        ],
        environment: { repo: "acme/test", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }),
    );
    expect(res.status).toBe(201);
    const { runId } = (await bodyOf(res)) as { runId: string };
    const { getRun } = await import("@agentops/db");
    const { createRunId } = await import("@agentops/core");
    const saved = getRun(db, createRunId(runId))!;
    expect(saved.agents).toEqual([
      { id: "agent-1", model: "claude-opus-4-6", role: "implementer" },
      { id: "agent-2", model: "claude-haiku-4-5", role: "reviewer" },
    ]);
  });

  it("CompleteRunRequest.testResults reach the stored run AND drive scoring", async () => {
    const runId = seedRun();
    // Body shaped like CompleteRunRequest (post-fix): failing test included.
    const res = await completeRunRoute(
      reqFor(`/api/sdk/runs/${runId}/complete`, {
        testResults: [
          { name: "passes", passed: true, duration: 10, message: "" },
          { name: "fails", passed: false, duration: 12, message: "assertion failed" },
        ],
        policyChecks: [],
        confidenceScore: 0.7,
        artifacts: [
          { id: "artifact_final", diffs: ["+x"], logs: [], testOutputs: ["1 failed"], reports: [] },
        ],
      }),
      withParams({ id: runId }),
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);

    // Scoring saw the tests: correctness is 1/2, not the "not scored" 1.0
    // that let mutating runs reach Merge with zero tests run.
    const score = body.score as { correctness: { score: number; rationale: string } };
    expect(score.correctness.score).toBe(0.5);
    expect(score.correctness.rationale).toContain("1/2 tests passing");

    // Round-trip: the evaluation + artifacts landed on the stored run.
    const { getRun } = await import("@agentops/db");
    const { createRunId } = await import("@agentops/core");
    const saved = getRun(db, createRunId(runId))!;
    expect(saved.evaluations).toHaveLength(1);
    expect(saved.evaluations[0]!.testResults).toHaveLength(2);
    expect(saved.evaluations[0]!.confidenceScore).toBe(0.7);
    expect(saved.artifacts.map((a) => a.id as string)).toContain("artifact_final");
  });

  it("ReportMetricsRequest is a partial update: omitted fields keep stored values", async () => {
    const runId = seedRun();
    // First report: tokens only.
    await reportMetricsRoute(
      reqFor(`/api/sdk/runs/${runId}/metrics`, {
        tokenUsage: { input: 100, output: 50, total: 150 },
      }),
      withParams({ id: runId }),
    );
    // Second report: cost + backend attribution only (ReportMetricsRequest
    // now declares backend/byModel so SDK clients can set Bedrock spend).
    const res = await reportMetricsRoute(
      reqFor(`/api/sdk/runs/${runId}/metrics`, {
        costUsd: 2.5,
        backend: "bedrock",
        byModel: { "us.anthropic.claude-opus-4-7-v1:0": 2.5 },
      }),
      withParams({ id: runId }),
    );
    expect(res.status).toBe(200);

    const { getRun } = await import("@agentops/db");
    const { createRunId } = await import("@agentops/core");
    const saved = getRun(db, createRunId(runId))!;
    // Tokens from report #1 survived report #2 (previously zero-filled).
    expect(saved.metrics.tokenUsage).toEqual({ input: 100, output: 50, total: 150 });
    expect(saved.metrics.costUsd).toBe(2.5);
    expect(saved.metrics.backend).toBe("bedrock");
    expect(saved.metrics.byModel).toEqual({ "us.anthropic.claude-opus-4-7-v1:0": 2.5 });
  });
});
