# @agentops/core

Domain types, policy engine, and scoring for [AgentOps](https://github.com/agentops-ai/agentops) — the control plane for autonomous AI agent teams.

## Overview

This package provides the foundational types and pure functions used across the AgentOps system:

- **Domain types** — Branded ID types, Run, Job, Session, Event, and all supporting entities
- **Policy engine** — Evaluate path restrictions, cost ceilings, test enforcement, and more
- **Scoring** — Compute a ScoreCard across 5 dimensions producing a merge recommendation
- **Builders** — Immutable builder functions for constructing and transitioning domain objects

## Installation

```bash
npm install @agentops/core
```

## Usage

```ts
import { createRun, createRunId, scoreRun } from "@agentops/core";
```

## License

MIT — see [LICENSE](../../LICENSE).
