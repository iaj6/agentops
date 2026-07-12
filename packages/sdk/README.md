# @agentops/sdk

Client SDK for agent runtimes to communicate with [AgentOps](https://github.com/agentops-ai/agentops) — the control plane for autonomous AI agent teams.

## Overview

Lightweight SDK that agent runtimes use to report activity back to the AgentOps control plane:

- **Session management** — Register, heartbeat, and terminate agent sessions
- **Event reporting** — Emit typed events for runs, jobs, policy violations, and cost tracking
- **Run lifecycle** — Start, update, and complete runs from within an agent process

## Installation

```bash
npm install @agentops/sdk
```

## Usage

```ts
import { AgentOpsClient } from "@agentops/sdk";
import { createAgentId, AgentRole } from "@agentops/core";

const client = new AgentOpsClient({ baseUrl: "http://localhost:3000", apiKey: "ao_..." });

const { sessionId } = await client.createSession({ agentId: "my-agent" });
const { runId } = await client.startRun({
  goal: { humanReadable: "Fix the bug", structured: { type: "bugfix", description: "", parameters: {} } },
  agents: [{ id: createAgentId("my-agent"), model: "claude-opus-4-6", role: AgentRole.Implementer }],
  environment: { repo: "acme/api", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
  sessionId,
});

// Metrics reports are partial updates — omitted fields keep their stored values.
await client.reportMetrics(runId, {
  tokenUsage: { input: 100, output: 50, total: 150 },
  costUsd: 0.05,
  backend: "bedrock", // optional Bedrock/Anthropic spend attribution
});

// Test results reported at completion drive the correctness score and
// merge recommendation.
const { recommendation } = await client.completeRun(runId, {
  testResults: [{ name: "unit", passed: true, duration: 12, message: "" }],
  confidenceScore: 0.9,
});

await client.terminateSession(sessionId);
```

## License

MIT — see [LICENSE](../../LICENSE).
