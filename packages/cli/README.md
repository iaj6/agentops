# @agentops/cli

CLI for [AgentOps](https://github.com/agentops-ai/agentops) — the control plane for autonomous AI agent teams.

## Installation

```bash
npm install -g @agentops/cli
```

## Usage

```bash
agentops run list              # List all recorded runs
agentops policy list           # List active policies
agentops report <run-id>       # Generate a run report
agentops job list              # List jobs in the queue
agentops session list          # List active sessions
agentops watch                 # Watch for real-time events
```

All commands support `--json` for machine-readable output and `--db-path` to override the database location.

## License

MIT — see [LICENSE](../../LICENSE).
