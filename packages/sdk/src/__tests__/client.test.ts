import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRunId,
  createSessionId,
  createAgentId,
  createArtifactId,
  AgentRole,
} from "@agentops/core";
import { AgentOpsClient, AgentOpsError, createClient } from "../client.js";
import { PolicyMiddleware, createMiddleware } from "../middleware.js";
import type {
  CreateSessionResponse,
  StartRunResponse,
  ReportActionResponse,
  ReportArtifactResponse,
  ReportMetricsResponse,
  CheckPolicyResponse,
  HeartbeatResponse,
  CompleteRunResponse,
  FailRunResponse,
} from "../types.js";

// These mocked response bodies mirror what the real /api/sdk/* handlers
// return (verified independently by the web package's sdk-contract.test.ts,
// which drives the actual handlers). Keep them in lockstep with the routes.

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as unknown as Response;
}

function errorResponse(status: number, error: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error }),
    headers: new Headers(),
  } as unknown as Response;
}

const BASE_URL = "http://localhost:3000";
const API_KEY = "test-api-key";

const testRunId = createRunId("run_test_1");
const testSessionId = createSessionId("session_test_1");

describe("createClient", () => {
  it("returns an AgentOpsClient instance", () => {
    const client = createClient({ baseUrl: BASE_URL });
    expect(client).toBeInstanceOf(AgentOpsClient);
  });
});

describe("AgentOpsClient", () => {
  let client: AgentOpsClient;

  beforeEach(() => {
    client = new AgentOpsClient({ baseUrl: BASE_URL, apiKey: API_KEY });
  });

  describe("createSession", () => {
    it("posts to /api/sdk/sessions and returns { sessionId, status }", async () => {
      const responseBody: CreateSessionResponse = {
        sessionId: testSessionId,
        status: "provisioning",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody, 201));

      const result = await client.createSession({ agentId: "agent-1" });

      expect(result.sessionId).toBe(testSessionId);
      expect(result.status).toBe("provisioning");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/sessions`,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({ agentId: "agent-1" }),
        }),
      );
    });
  });

  describe("startRun", () => {
    it("posts to /api/sdk/runs and returns { runId, status }", async () => {
      const responseBody: StartRunResponse = {
        runId: testRunId,
        status: "running",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody, 201));

      const result = await client.startRun({
        goal: {
          humanReadable: "Fix bug",
          structured: { type: "bugfix", description: "Fix bug", parameters: {} },
        },
        agents: [
          { id: createAgentId("agent-1"), model: "claude-opus-4-6", role: AgentRole.Implementer },
        ],
        environment: {
          repo: "acme/backend",
          branch: "fix",
          permissions: ["read", "write"],
          sandbox: { enabled: true, isolationLevel: "container" },
        },
      });

      expect(result.runId).toBe(testRunId);
      expect(result.status).toBe("running");

      // The declared agents must actually go over the wire — the server
      // persists them onto the run (request-side contract).
      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.agents).toEqual([
        { id: "agent-1", model: "claude-opus-4-6", role: "implementer" },
      ]);
    });
  });

  describe("reportAction", () => {
    it("posts action and returns { runId, actionId }", async () => {
      const responseBody: ReportActionResponse = {
        runId: testRunId,
        actionId: "action_1",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.reportAction(testRunId, {
        fileEdits: [
          { path: "src/config.ts", diff: "+line", timestamp: "2025-01-01T00:00:00.000Z" },
        ],
      });

      expect(result.actionId).toBe("action_1");
      expect(result.runId).toBe(testRunId);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/runs/${testRunId}/actions`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("reportArtifact", () => {
    it("posts artifact and returns { runId, artifactId }", async () => {
      const responseBody: ReportArtifactResponse = {
        runId: testRunId,
        artifactId: "artifact_1",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.reportArtifact(testRunId, { logs: ["build output log"] });

      expect(result.artifactId).toBe("artifact_1");
    });
  });

  describe("reportMetrics", () => {
    it("posts metrics and returns { runId }", async () => {
      const responseBody: ReportMetricsResponse = { runId: testRunId };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.reportMetrics(testRunId, {
        tokenUsage: { input: 100, output: 50, total: 150 },
        costUsd: 0.05,
      });

      expect(result.runId).toBe(testRunId);
    });

    it("sends backend and byModel for Bedrock spend attribution", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse<ReportMetricsResponse>({ runId: testRunId }));

      await client.reportMetrics(testRunId, {
        costUsd: 2.5,
        backend: "bedrock",
        byModel: { "us.anthropic.claude-opus-4-7-v1:0": 2.5 },
      });

      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.backend).toBe("bedrock");
      expect(sentBody.byModel).toEqual({ "us.anthropic.claude-opus-4-7-v1:0": 2.5 });
    });
  });

  describe("checkPolicy", () => {
    it("posts toolName/toolInput and returns a decision", async () => {
      const responseBody: CheckPolicyResponse = {
        decision: "allow",
        violations: [],
        warnings: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.checkPolicy(testRunId, {
        toolName: "Edit",
        toolInput: { file_path: "src/config.ts" },
      });

      expect(result.decision).toBe("allow");
      expect(result.violations).toHaveLength(0);

      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.runId).toBe(testRunId);
      expect(sentBody.toolName).toBe("Edit");
      expect(sentBody.toolInput).toEqual({ file_path: "src/config.ts" });
    });

    it("returns violations when policy blocks", async () => {
      const responseBody: CheckPolicyResponse = {
        decision: "block",
        reason: "[PathRestriction] Path not allowed",
        violations: [{ policy: "PathRestriction", message: "Path not allowed", severity: "error" }],
        warnings: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.checkPolicy(testRunId, {
        toolName: "Write",
        toolInput: { file_path: "secrets/keys.json" },
      });

      expect(result.decision).toBe("block");
      expect(result.reason).toContain("PathRestriction");
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.policy).toBe("PathRestriction");
    });
  });

  describe("heartbeat", () => {
    it("posts to /api/sdk/sessions/:id/heartbeat and returns { ok, commands }", async () => {
      const responseBody: HeartbeatResponse = { ok: true, commands: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.heartbeat(testSessionId);

      expect(result.ok).toBe(true);
      expect(result.commands).toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/sessions/${testSessionId}/heartbeat`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("completeRun", () => {
    it("posts to /api/sdk/runs/:id/complete and returns { runId, score, ... }", async () => {
      // Full score/summary shapes are verified by sdk-contract.test.ts against
      // the real handler; here we only exercise client plumbing + return.
      const responseBody = { runId: testRunId } as unknown as CompleteRunResponse;
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.completeRun(testRunId);
      expect(result.runId).toBe(testRunId);
    });

    it("sends result when provided (deprecated, still transmitted)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ runId: testRunId } as unknown as CompleteRunResponse),
      );

      await client.completeRun(testRunId, { result: "Bug fixed successfully" });

      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.result).toBe("Bug fixed successfully");
    });

    it("sends testResults / policyChecks / confidenceScore / artifacts", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ runId: testRunId } as unknown as CompleteRunResponse),
      );

      await client.completeRun(testRunId, {
        testResults: [{ name: "unit", passed: false, duration: 5, message: "boom" }],
        policyChecks: [],
        confidenceScore: 0.8,
        artifacts: [
          {
            id: createArtifactId("artifact_1"),
            diffs: [],
            logs: [],
            testOutputs: ["1 failed"],
            reports: [],
          },
        ],
      });

      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.testResults).toEqual([
        { name: "unit", passed: false, duration: 5, message: "boom" },
      ]);
      expect(sentBody.policyChecks).toEqual([]);
      expect(sentBody.confidenceScore).toBe(0.8);
      expect(sentBody.artifacts).toHaveLength(1);
      expect(sentBody.artifacts[0].id).toBe("artifact_1");
    });
  });

  describe("terminateSession", () => {
    it("posts to /api/sdk/sessions/:id/terminate and returns { status }", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: "terminated" }));

      const result = await client.terminateSession(testSessionId);

      expect(result.status).toBe("terminated");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/sessions/${testSessionId}/terminate`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("failRun", () => {
    it("posts to /api/sdk/runs/:id/fail and returns { ok }", async () => {
      const responseBody: FailRunResponse = { ok: true };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.failRun(testRunId, "Compilation failed");

      expect(result.ok).toBe(true);
      const sentBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
      expect(sentBody.error).toBe("Compilation failed");
    });
  });

  describe("error handling", () => {
    it("throws AgentOpsError on server error with message", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, "Internal server error"));
      await expect(client.createSession({ agentId: "agent-1" })).rejects.toThrow(AgentOpsError);

      try {
        mockFetch.mockResolvedValueOnce(errorResponse(500, "Internal server error"));
        await client.createSession({ agentId: "agent-1" });
      } catch (e) {
        expect(e).toBeInstanceOf(AgentOpsError);
        expect((e as AgentOpsError).statusCode).toBe(500);
        expect((e as AgentOpsError).message).toBe("Internal server error");
      }
    });

    it("throws AgentOpsError on 404", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, "Not found"));
      try {
        await client.heartbeat(testSessionId);
      } catch (e) {
        expect((e as AgentOpsError).statusCode).toBe(404);
      }
    });

    it("throws AgentOpsError on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(client.createSession({ agentId: "agent-1" })).rejects.toThrow(AgentOpsError);
    });

    it("handles non-JSON error responses gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not JSON")),
        headers: new Headers(),
      } as unknown as Response);
      try {
        await client.createSession({ agentId: "agent-1" });
      } catch (e) {
        expect((e as AgentOpsError).statusCode).toBe(502);
        expect((e as AgentOpsError).message).toBe("HTTP 502");
      }
    });

    it("throws AgentOpsError when a 200 body is not valid JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("not JSON")),
        headers: new Headers(),
      } as unknown as Response);
      await expect(client.createSession({ agentId: "agent-1" })).rejects.toThrow(AgentOpsError);
    });

    it("throws AgentOpsError when a 200 body is not an object", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse("just a string" as unknown as CreateSessionResponse));
      await expect(client.createSession({ agentId: "agent-1" })).rejects.toThrow(
        /Unexpected response shape/,
      );
    });

    it("throws AgentOpsError when a 200 body is a top-level array", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([] as unknown as CreateSessionResponse));
      await expect(client.createSession({ agentId: "agent-1" })).rejects.toThrow(
        /Unexpected response shape/,
      );
    });
  });

  describe("authentication", () => {
    it("includes Authorization header when apiKey is set", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse<CreateSessionResponse>({ sessionId: testSessionId, status: "active" }),
      );
      await client.createSession({ agentId: "agent-1" });
      const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    });

    it("omits Authorization header when apiKey is not set", async () => {
      const noAuthClient = new AgentOpsClient({ baseUrl: BASE_URL });
      mockFetch.mockResolvedValueOnce(
        jsonResponse<CreateSessionResponse>({ sessionId: testSessionId, status: "active" }),
      );
      await noAuthClient.createSession({ agentId: "agent-1" });
      const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("base URL handling", () => {
    it("strips trailing slashes from base URL", async () => {
      const trailingSlashClient = new AgentOpsClient({ baseUrl: "http://localhost:3000///" });
      mockFetch.mockResolvedValueOnce(
        jsonResponse<CreateSessionResponse>({ sessionId: testSessionId, status: "active" }),
      );
      await trailingSlashClient.createSession({ agentId: "agent-1" });
      expect(mockFetch.mock.calls[0]![0] as string).toBe("http://localhost:3000/api/sdk/sessions");
    });
  });
});

describe("PolicyMiddleware", () => {
  let client: AgentOpsClient;
  let middleware: PolicyMiddleware;

  beforeEach(() => {
    client = new AgentOpsClient({ baseUrl: BASE_URL });
    middleware = createMiddleware(client);
  });

  describe("checkAndReport", () => {
    it("checks policy and reports action when allowed", async () => {
      const policyResponse: CheckPolicyResponse = { decision: "allow", violations: [], warnings: [] };
      const actionResponse: ReportActionResponse = { runId: testRunId, actionId: "action_1" };
      mockFetch
        .mockResolvedValueOnce(jsonResponse(policyResponse))
        .mockResolvedValueOnce(jsonResponse(actionResponse));

      const result = await middleware.checkAndReport(
        testRunId,
        { toolName: "Edit", toolInput: { file_path: "src/config.ts" } },
        { fileEdits: [{ path: "src/config.ts", diff: "+line", timestamp: "2025-01-01T00:00:00.000Z" }] },
      );

      expect(result.policyCheck.permitted).toBe(true);
      expect(result.action).not.toBeNull();
      expect(result.action!.actionId).toBe("action_1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("checks policy and skips action when blocked", async () => {
      const policyResponse: CheckPolicyResponse = {
        decision: "block",
        violations: [{ policy: "PathRestriction", message: "Not allowed" }],
        warnings: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(policyResponse));

      const result = await middleware.checkAndReport(
        testRunId,
        { toolName: "Write", toolInput: { file_path: "secrets/keys.json" } },
        { fileEdits: [{ path: "secrets/keys.json", diff: "+secret", timestamp: "2025-01-01T00:00:00.000Z" }] },
      );

      expect(result.policyCheck.permitted).toBe(false);
      expect(result.policyCheck.violations).toHaveLength(1);
      expect(result.action).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("check", () => {
    it("returns permitted=true for an allow decision", async () => {
      const policyResponse: CheckPolicyResponse = { decision: "allow", violations: [], warnings: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(policyResponse));

      const result = await middleware.check(testRunId, {
        toolName: "Edit",
        toolInput: { file_path: "src/app.ts" },
      });

      expect(result.permitted).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
