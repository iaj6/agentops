# @agentops/db

SQLite persistence layer for [AgentOps](https://github.com/agentops-ai/agentops) — the control plane for autonomous AI agent teams.

## Overview

This package provides database access for AgentOps using Drizzle ORM and better-sqlite3:

- **Schema** — Eight tables: runs, policies, policy_results, run_metrics, jobs, sessions, events, locks
- **Repository functions** — Insert, get, list, and update operations for all entities
- **Migrations** — Drizzle Kit-based schema generation and migration

## Installation

```bash
npm install @agentops/db
```

## Usage

```ts
import { createDb, insertRun, listRuns } from "@agentops/db";
```

The database defaults to `~/.agentops/agentops.db`. Override with the `AGENTOPS_DB_PATH` environment variable.

## License

MIT — see [LICENSE](../../LICENSE).
