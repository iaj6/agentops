import type { RunId, SessionId } from "@agentops/core";

import type {
  ClientConfig,
  CreateSessionRequest,
  CreateSessionResponse,
  StartRunRequest,
  StartRunResponse,
  ReportActionRequest,
  ReportActionResponse,
  ReportArtifactRequest,
  ReportArtifactResponse,
  ReportMetricsRequest,
  ReportMetricsResponse,
  CheckPolicyRequest,
  CheckPolicyResponse,
  HeartbeatResponse,
  TerminateSessionResponse,
  CompleteRunRequest,
  CompleteRunResponse,
  FailRunRequest,
  FailRunResponse,
} from "./types.js";

const DEFAULT_TIMEOUT = 30_000;

export class AgentOpsError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AgentOpsError";
    this.statusCode = statusCode;
  }
}

export class AgentOpsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AgentOpsError(`Request timed out after ${this.timeout}ms`, 0);
      }
      throw new AgentOpsError(
        error instanceof Error ? error.message : "Network error",
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as { error?: string };
        if (errorBody.error) {
          message = errorBody.error;
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new AgentOpsError(message, response.status);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new AgentOpsError("Invalid JSON response from server", response.status);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AgentOpsError("Unexpected response shape from server", response.status);
    }
    return parsed as T;
  }

  async createSession(
    opts: CreateSessionRequest,
  ): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>("/api/sdk/sessions", opts);
  }

  async startRun(opts: StartRunRequest): Promise<StartRunResponse> {
    return this.request<StartRunResponse>("/api/sdk/runs", opts);
  }

  async reportAction(
    runId: RunId,
    action: ReportActionRequest,
  ): Promise<ReportActionResponse> {
    return this.request<ReportActionResponse>(
      `/api/sdk/runs/${runId}/actions`,
      action,
    );
  }

  async reportArtifact(
    runId: RunId,
    artifact: ReportArtifactRequest,
  ): Promise<ReportArtifactResponse> {
    return this.request<ReportArtifactResponse>(
      `/api/sdk/runs/${runId}/artifacts`,
      artifact,
    );
  }

  async reportMetrics(
    runId: RunId,
    metrics: ReportMetricsRequest,
  ): Promise<ReportMetricsResponse> {
    return this.request<ReportMetricsResponse>(
      `/api/sdk/runs/${runId}/metrics`,
      metrics,
    );
  }

  async checkPolicy(
    runId: RunId,
    action: CheckPolicyRequest,
  ): Promise<CheckPolicyResponse> {
    return this.request<CheckPolicyResponse>("/api/sdk/policy/check", {
      runId,
      ...action,
    });
  }

  async heartbeat(sessionId: SessionId): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>(
      `/api/sdk/sessions/${sessionId}/heartbeat`,
      {},
    );
  }

  /**
   * Gracefully end a session: archives its current run and marks it
   * terminated. Without this, SDK-created sessions only end when the
   * server's staleness reaper gives up on their heartbeats.
   */
  async terminateSession(
    sessionId: SessionId,
  ): Promise<TerminateSessionResponse> {
    return this.request<TerminateSessionResponse>(
      `/api/sdk/sessions/${sessionId}/terminate`,
      {},
    );
  }

  async completeRun(
    runId: RunId,
    result?: CompleteRunRequest,
  ): Promise<CompleteRunResponse> {
    return this.request<CompleteRunResponse>(
      `/api/sdk/runs/${runId}/complete`,
      result ?? {},
    );
  }

  async failRun(runId: RunId, error: string): Promise<FailRunResponse> {
    const body: FailRunRequest = { error };
    return this.request<FailRunResponse>(`/api/sdk/runs/${runId}/fail`, body);
  }
}

export function createClient(config: ClientConfig): AgentOpsClient {
  return new AgentOpsClient(config);
}
