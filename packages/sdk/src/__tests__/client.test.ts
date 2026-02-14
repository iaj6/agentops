import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRunId,
  createSessionId,
  createAgentId,
  AgentRole,
  RunStatus,
  SessionStatus,
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
    it("posts to /api/sdk/sessions and returns session", async () => {
      const responseBody: CreateSessionResponse = {
        session: {
          id: testSessionId,
          status: SessionStatus.Provisioning,
          agentId: createAgentId("agent-1"),
          currentRunId: null,
          completedRunIds: [],
          resourceUsage: {
            memoryMb: 0,
            cpuPercent: 0,
            tokensBudgetRemaining: 0,
            costBudgetRemaining: 0,
          },
          metadata: {},
          startedAt: "2025-01-01T00:00:00.000Z",
          lastHeartbeatAt: "2025-01-01T00:00:00.000Z",
          terminatedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.createSession({ agentId: "agent-1" });

      expect(result.session.id).toBe(testSessionId);
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
    it("posts to /api/sdk/runs and returns run", async () => {
      const responseBody: StartRunResponse = {
        run: {
          id: testRunId,
          status: RunStatus.Running,
          goal: {
            humanReadable: "Fix bug",
            structured: {
              type: "bugfix",
              description: "Fix bug",
              parameters: {},
            },
          },
          agents: [
            {
              id: createAgentId("agent-1"),
              model: "claude-opus-4-6",
              role: AgentRole.Implementer,
            },
          ],
          environment: {
            repo: "acme/backend",
            branch: "fix",
            permissions: ["read", "write"],
            sandbox: { enabled: true, isolationLevel: "container" },
          },
          actions: [],
          artifacts: [],
          metrics: {
            tokenUsage: { input: 0, output: 0, total: 0 },
            wallTimeMs: 0,
            costUsd: 0,
            flakeRate: 0,
          },
          evaluations: [],
          decisions: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.startRun({
        goal: {
          humanReadable: "Fix bug",
          structured: {
            type: "bugfix",
            description: "Fix bug",
            parameters: {},
          },
        },
        agents: [
          {
            id: createAgentId("agent-1"),
            model: "claude-opus-4-6",
            role: AgentRole.Implementer,
          },
        ],
        environment: {
          repo: "acme/backend",
          branch: "fix",
          permissions: ["read", "write"],
          sandbox: { enabled: true, isolationLevel: "container" },
        },
      });

      expect(result.run.id).toBe(testRunId);
      expect(result.run.status).toBe(RunStatus.Running);
    });
  });

  describe("reportAction", () => {
    it("posts action to /api/sdk/runs/:id/actions", async () => {
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
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/runs/${testRunId}/actions`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("reportArtifact", () => {
    it("posts artifact to /api/sdk/runs/:id/artifacts", async () => {
      const responseBody: ReportArtifactResponse = {
        runId: testRunId,
        artifactId: "artifact_1",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.reportArtifact(testRunId, {
        logs: ["build output log"],
      });

      expect(result.artifactId).toBe("artifact_1");
    });
  });

  describe("reportMetrics", () => {
    it("posts metrics to /api/sdk/runs/:id/metrics", async () => {
      const responseBody: ReportMetricsResponse = { runId: testRunId };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.reportMetrics(testRunId, {
        tokenUsage: { input: 100, output: 50, total: 150 },
        costUsd: 0.05,
      });

      expect(result.runId).toBe(testRunId);
    });
  });

  describe("checkPolicy", () => {
    it("posts to /api/sdk/policy/check and returns permit result", async () => {
      const responseBody: CheckPolicyResponse = {
        permit: true,
        violations: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.checkPolicy(testRunId, {
        type: "FileEdit",
        path: "src/config.ts",
      });

      expect(result.permit).toBe(true);
      expect(result.violations).toHaveLength(0);

      const sentBody = JSON.parse(
        mockFetch.mock.calls[0]![1].body as string,
      );
      expect(sentBody.runId).toBe(testRunId);
      expect(sentBody.type).toBe("FileEdit");
    });

    it("returns violations when policy denies", async () => {
      const responseBody: CheckPolicyResponse = {
        permit: false,
        violations: [
          { policy: "PathRestriction", message: "Path not allowed" },
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.checkPolicy(testRunId, {
        type: "FileEdit",
        path: "secrets/keys.json",
      });

      expect(result.permit).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.policy).toBe("PathRestriction");
    });
  });

  describe("heartbeat", () => {
    it("posts to /api/sdk/sessions/:id/heartbeat", async () => {
      const responseBody: HeartbeatResponse = {
        sessionId: testSessionId,
        status: "active",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.heartbeat(testSessionId);

      expect(result.sessionId).toBe(testSessionId);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/sdk/sessions/${testSessionId}/heartbeat`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("completeRun", () => {
    it("posts to /api/sdk/runs/:id/complete", async () => {
      const responseBody: CompleteRunResponse = {
        run: {
          id: testRunId,
          status: RunStatus.Completed,
          goal: {
            humanReadable: "Fix bug",
            structured: {
              type: "bugfix",
              description: "Fix bug",
              parameters: {},
            },
          },
          agents: [],
          environment: {
            repo: "acme/backend",
            branch: "fix",
            permissions: [],
            sandbox: { enabled: false, isolationLevel: "none" },
          },
          actions: [],
          artifacts: [],
          metrics: {
            tokenUsage: { input: 0, output: 0, total: 0 },
            wallTimeMs: 0,
            costUsd: 0,
            flakeRate: 0,
          },
          evaluations: [],
          decisions: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.completeRun(testRunId);

      expect(result.run.status).toBe(RunStatus.Completed);
    });

    it("sends result when provided", async () => {
      const responseBody: CompleteRunResponse = {
        run: {
          id: testRunId,
          status: RunStatus.Completed,
          goal: {
            humanReadable: "Fix bug",
            structured: {
              type: "bugfix",
              description: "Fix bug",
              parameters: {},
            },
          },
          agents: [],
          environment: {
            repo: "acme/backend",
            branch: "fix",
            permissions: [],
            sandbox: { enabled: false, isolationLevel: "none" },
          },
          actions: [],
          artifacts: [],
          metrics: {
            tokenUsage: { input: 0, output: 0, total: 0 },
            wallTimeMs: 0,
            costUsd: 0,
            flakeRate: 0,
          },
          evaluations: [],
          decisions: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      await client.completeRun(testRunId, { result: "Bug fixed successfully" });

      const sentBody = JSON.parse(
        mockFetch.mock.calls[0]![1].body as string,
      );
      expect(sentBody.result).toBe("Bug fixed successfully");
    });
  });

  describe("failRun", () => {
    it("posts to /api/sdk/runs/:id/fail", async () => {
      const responseBody: FailRunResponse = {
        run: {
          id: testRunId,
          status: RunStatus.Failed,
          goal: {
            humanReadable: "Fix bug",
            structured: {
              type: "bugfix",
              description: "Fix bug",
              parameters: {},
            },
          },
          agents: [],
          environment: {
            repo: "acme/backend",
            branch: "fix",
            permissions: [],
            sandbox: { enabled: false, isolationLevel: "none" },
          },
          actions: [],
          artifacts: [],
          metrics: {
            tokenUsage: { input: 0, output: 0, total: 0 },
            wallTimeMs: 0,
            costUsd: 0,
            flakeRate: 0,
          },
          evaluations: [],
          decisions: [],
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.failRun(testRunId, "Compilation failed");

      expect(result.run.status).toBe(RunStatus.Failed);
      const sentBody = JSON.parse(
        mockFetch.mock.calls[0]![1].body as string,
      );
      expect(sentBody.error).toBe("Compilation failed");
    });
  });

  describe("error handling", () => {
    it("throws AgentOpsError on server error with message", async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(500, "Internal server error"),
      );

      await expect(
        client.createSession({ agentId: "agent-1" }),
      ).rejects.toThrow(AgentOpsError);

      try {
        mockFetch.mockResolvedValueOnce(
          errorResponse(500, "Internal server error"),
        );
        await client.createSession({ agentId: "agent-1" });
      } catch (e) {
        expect(e).toBeInstanceOf(AgentOpsError);
        const err = e as AgentOpsError;
        expect(err.statusCode).toBe(500);
        expect(err.message).toBe("Internal server error");
      }
    });

    it("throws AgentOpsError on 404", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, "Not found"));

      try {
        await client.heartbeat(testSessionId);
      } catch (e) {
        expect(e).toBeInstanceOf(AgentOpsError);
        const err = e as AgentOpsError;
        expect(err.statusCode).toBe(404);
      }
    });

    it("throws AgentOpsError on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(
        client.createSession({ agentId: "agent-1" }),
      ).rejects.toThrow(AgentOpsError);
    });

    it("handles non-JSON error responses gracefully", async () => {
      const response = {
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not JSON")),
        headers: new Headers(),
      } as unknown as Response;
      mockFetch.mockResolvedValueOnce(response);

      try {
        await client.createSession({ agentId: "agent-1" });
      } catch (e) {
        expect(e).toBeInstanceOf(AgentOpsError);
        const err = e as AgentOpsError;
        expect(err.statusCode).toBe(502);
        expect(err.message).toBe("HTTP 502");
      }
    });
  });

  describe("authentication", () => {
    it("includes Authorization header when apiKey is set", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ session: {} } as CreateSessionResponse),
      );

      await client.createSession({ agentId: "agent-1" });

      const headers = mockFetch.mock.calls[0]![1].headers as Record<
        string,
        string
      >;
      expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    });

    it("omits Authorization header when apiKey is not set", async () => {
      const noAuthClient = new AgentOpsClient({ baseUrl: BASE_URL });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ session: {} } as CreateSessionResponse),
      );

      await noAuthClient.createSession({ agentId: "agent-1" });

      const headers = mockFetch.mock.calls[0]![1].headers as Record<
        string,
        string
      >;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("base URL handling", () => {
    it("strips trailing slashes from base URL", async () => {
      const trailingSlashClient = new AgentOpsClient({
        baseUrl: "http://localhost:3000///",
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ session: {} } as CreateSessionResponse),
      );

      await trailingSlashClient.createSession({ agentId: "agent-1" });

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe("http://localhost:3000/api/sdk/sessions");
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
    it("checks policy and reports action when permitted", async () => {
      const policyResponse: CheckPolicyResponse = {
        permit: true,
        violations: [],
      };
      const actionResponse: ReportActionResponse = {
        runId: testRunId,
        actionId: "action_1",
      };

      mockFetch
        .mockResolvedValueOnce(jsonResponse(policyResponse))
        .mockResolvedValueOnce(jsonResponse(actionResponse));

      const result = await middleware.checkAndReport(
        testRunId,
        { type: "FileEdit", path: "src/config.ts" },
        {
          fileEdits: [
            {
              path: "src/config.ts",
              diff: "+line",
              timestamp: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      );

      expect(result.policyCheck.permitted).toBe(true);
      expect(result.action).not.toBeNull();
      expect(result.action!.actionId).toBe("action_1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("checks policy and skips action when denied", async () => {
      const policyResponse: CheckPolicyResponse = {
        permit: false,
        violations: [
          { policy: "PathRestriction", message: "Not allowed" },
        ],
      };

      mockFetch.mockResolvedValueOnce(jsonResponse(policyResponse));

      const result = await middleware.checkAndReport(
        testRunId,
        { type: "FileEdit", path: "secrets/keys.json" },
        {
          fileEdits: [
            {
              path: "secrets/keys.json",
              diff: "+secret",
              timestamp: "2025-01-01T00:00:00.000Z",
            },
          ],
        },
      );

      expect(result.policyCheck.permitted).toBe(false);
      expect(result.policyCheck.violations).toHaveLength(1);
      expect(result.action).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("check", () => {
    it("returns policy check result", async () => {
      const policyResponse: CheckPolicyResponse = {
        permit: true,
        violations: [],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(policyResponse));

      const result = await middleware.check(testRunId, {
        type: "FileEdit",
        path: "src/app.ts",
      });

      expect(result.permitted).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
