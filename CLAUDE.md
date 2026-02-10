# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (npm workspaces)
npm install

# Build all packages
npm run build

# Build a single package
npm run build --workspace=packages/core

# Run all tests (Vitest)
npm run test

# Run tests for a single package
npm run test --workspace=packages/core

# Run a single test file
npx vitest run packages/core/src/__tests__/scoring.test.ts

# Start web dashboard dev server (localhost:3000)
npm run dev

# Database operations (from packages/db)
npm run db:generate    # Generate Drizzle migrations
npm run db:migrate     # Apply migrations
npm run db:seed        # Populate with sample data
```

## Architecture

AgentOps is "The Control Plane for Autonomous Agent Teams" — an npm workspaces monorepo with 4 packages. It wraps agent runtimes to provide observability, constraints, verification, cost control, and accountability for autonomous AI agent work.

### Package Dependency Graph

```
core  ← db  ← cli
             ← web
```

- **@agentops/core** — Domain types, policy engine, scoring algorithm, and builder functions for all entities. No external dependencies. All types use `readonly` and branded ID types (RunId, JobId, SessionId, etc.) for type safety.
- **@agentops/db** — SQLite persistence via Drizzle ORM + better-sqlite3. Eight tables: `runs`, `policies`, `policy_results`, `run_metrics`, `jobs`, `sessions`, `events`, `locks`. Complex fields stored as JSON columns. DB defaults to `~/.agentops/agentops.db` (override with `AGENTOPS_DB_PATH`).
- **@agentops/cli** — CLI entry point (`agentops`). Commands: `run`, `policy`, `report`, `wrap`, `watch`, `link`, `pr`, `job`, `session`, `events`, `lock`. Supports `--json` output and `--db-path` override.
- **@agentops/web** — Next.js 16 App Router dashboard with React 19, Tailwind CSS 4. 25+ API routes under `src/app/api/`. Server components access SQLite directly. Uses `serverExternalPackages: ["better-sqlite3"]` in next.config.ts.

### Core Domain Concepts

**Run** is the central abstraction — an immutable, timestamped record of one autonomous execution containing: Goal, Agents (with roles: Lead/Implementer/Reviewer/CI/Policy), Environment, Actions, Artifacts, Metrics, Evaluations, Decisions, and optional GitHub links. Run modifications always return new objects; never mutate in-place.

**Job** (`core/src/job.ts`) is a dispatchable unit of work. Jobs have priority (Critical/High/Normal/Low), retry policies, and concurrency limits. A Job produces one or more Runs and tracks lifecycle: Queued → Dispatched → Running → Completed/Failed. The **Dispatcher** (`core/src/dispatcher.ts`) provides pure functions for queue ordering, dispatch decisions based on concurrency limits, and session matching.

**Session** (`core/src/session.ts`) represents an agent runtime's lifecycle: Provisioning → Active → Paused → Terminated. Sessions track the current Run being executed, completed Runs, resource usage (memory, CPU, token/cost budgets), and heartbeats for liveness detection.

**Event System** (`core/src/events.ts`) provides a typed event bus. `EVENT_TYPES` defines all events (job.queued, run.started, session.terminated, policy.violated, cost.threshold, etc.). `EventBus` class supports subscribe/unsubscribe/publish with wildcard `"*"` subscriptions. Events are persisted in the `events` table for audit trail. The web SSE endpoint reads from the events table.

**Coordination** (`core/src/coordination.ts`) handles multi-agent resource management. Lock lifecycle (createLock, releaseLock, isLockExpired, isLockHeld), conflict detection (checkConflicts checks for overlapping repo/path/branch locks), branch isolation (generateWorkBranch), and work partitioning (partitionByPath).

**Policy Engine** (`core/src/policy.ts`) evaluates 6 policy types: PathRestriction, FileLimitCount, CostCeiling, RequiredApproval, TestEnforcement, RiskyOpFlag. New policy types must extend the `PolicyConfig` union type.

**Scoring** (`core/src/scoring.ts`) computes a ScoreCard across 5 dimensions (Correctness, RegressionRisk, ScopeRisk, PolicyCompliance, Unknowns) as 0–1 ratios, producing a MergeRecommendation of Merge | Block | Review.

### Key Conventions

- TypeScript 5.7 strict mode, ES2022 target, bundler module resolution
- Always use branded ID constructors (`createRunId()`, `createJobId()`, `createSessionId()`, etc.) — never raw strings for IDs
- Immutable builder pattern: all state transitions return new objects via spread (see `run.ts`, `job.ts`, `session.ts`)
- Repository pattern: all DB functions take `(db: AgentOpsDb, ...)` as first arg, named `insertX`, `getX`, `listX`, `updateX`
- Tests colocated in `src/__tests__/` directories, pattern `*.test.ts`
- Web API routes use `force-dynamic` to ensure fresh data on every request
- CLI commands registered via `registerXCommands(program)` pattern in `cli/src/index.ts`
- CLI auto-detects git repo/branch; can override with `--repo` and `--branch` flags
