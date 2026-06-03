import type { RunId } from "@agentops/core";
import type { AgentOpsClient } from "./client.js";
import type {
  CheckPolicyRequest,
  CheckPolicyResponse,
  ReportActionRequest,
  ReportActionResponse,
} from "./types.js";
import { AgentOpsError } from "./client.js";

export interface PolicyCheckResult {
  readonly permitted: boolean;
  readonly violations: CheckPolicyResponse["violations"];
}

export interface MiddlewareResult {
  readonly policyCheck: PolicyCheckResult;
  readonly action: ReportActionResponse | null;
}

export class PolicyMiddleware {
  private readonly client: AgentOpsClient;

  constructor(client: AgentOpsClient) {
    this.client = client;
  }

  async checkAndReport(
    runId: RunId,
    policyRequest: CheckPolicyRequest,
    actionRequest: ReportActionRequest,
  ): Promise<MiddlewareResult> {
    const policyResponse = await this.client.checkPolicy(runId, policyRequest);

    const policyCheck: PolicyCheckResult = {
      permitted: policyResponse.decision === "allow",
      violations: policyResponse.violations,
    };

    if (policyResponse.decision !== "allow") {
      return { policyCheck, action: null };
    }

    const action = await this.client.reportAction(runId, actionRequest);
    return { policyCheck, action };
  }

  async check(
    runId: RunId,
    request: CheckPolicyRequest,
  ): Promise<PolicyCheckResult> {
    const response = await this.client.checkPolicy(runId, request);
    return {
      permitted: response.decision === "allow",
      violations: response.violations,
    };
  }
}

export function createMiddleware(client: AgentOpsClient): PolicyMiddleware {
  return new PolicyMiddleware(client);
}
