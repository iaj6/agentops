# @agentops/web

Web dashboard for [AgentOps](https://github.com/agentops-ai/agentops) — the control plane for autonomous AI agent teams.

## Overview

A Next.js 16 App Router dashboard providing a real-time UI for the AgentOps system:

- **Run explorer** — Browse, search, and inspect autonomous agent runs
- **Fleet dashboard** — Monitor active sessions, jobs, and resource usage
- **Policy management** — View and manage policy configurations and violations
- **Real-time updates** — Server-Sent Events for live activity feeds

## Development

```bash
npm run dev    # Start dev server on localhost:3000
```

This package is not published to npm. It is served locally via `agentops serve` from the CLI.

## License

MIT — see [LICENSE](../../LICENSE).
