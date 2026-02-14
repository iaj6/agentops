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

const client = new AgentOpsClient({ baseUrl: "http://localhost:3000" });
await client.startSession({ agentId: "my-agent" });
```

## License

MIT — see [LICENSE](../../LICENSE).
