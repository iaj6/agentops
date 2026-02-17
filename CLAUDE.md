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

# Lint (web package only, ESLint flat config)
npm run lint --workspace=packages/web

# Database operations (from packages/db)
npm run db:generate    # Generate Drizzle migrations
npm run db:migrate     # Apply migrations
npm run db:seed        # Populate with sample data
npm run db:studio      # Open Drizzle Studio for visual DB inspection

# Dogfooding workflow (via CLI)
agentops init              # Bootstrap DB (first time)
agentops init --seed       # Bootstrap with sample data
Great,      # Reset DB to empty
agentops serve             # Start dashboard at localhost:3000
agentops serve --port 8080 # Start on custom port
agentops wrap "command"    # Wrap a command with real-time event streaming
agentops setup             # Configure Claude Code hooks (project-level)
agentops setup --global    # Configure hooks globally (~/.claude/settings.json)
agentops setup --uninstall # Remove AgentOps hooks
```

## Architecture

AgentOps is "The Control Plane for Autonomous Agent Teams" — an npm workspaces monorepo with 5 packages. It wraps agent runtimes to provide observability, constraints, verification, cost control, and accountability for autonomous AI agent work.

### Package Dependency Graph

```
core  ← db  ← cli
             ← web
      ← sdk
```

- **@agentops/core** — Domain types, policy engine, scoring algorithm, and builder functions for all entities. No external dependencies. All types use `readonly` and branded ID types (RunId, JobId, SessionId, etc.) for type safety.
- **@agentops/db** — SQLite persistence via Drizzle ORM + better-sqlite3. Eight tables: `runs`, `policies`, `policy_results`, `run_metrics`, `jobs`, `sessions`, `events`, `locks`. Complex fields stored as JSON columns. DB defaults to `~/.agentops/agentops.db` (override with `AGENTOPS_DB_PATH`).
- **@agentops/cli** — CLI entry point (`agentops`). Commands: `init`, `serve`, `setup`, `hook`, `run`, `policy`, `report`, `wrap`, `watch`, `link`, `pr`, `job`, `session`, `events`, `lock`, `dispatch`. Supports `--json` output and `--db-path` override. `init` bootstraps the DB (`--seed` for sample data, `--clean` to reset). `serve` starts the dashboard server (`--port` to override 3000). `setup` configures Claude Code hooks (`--global`, `--uninstall`, `--dry-run`). `hook` handles Claude Code hook events (session-start, pre-tool-use, post-tool-use, session-end) — reads JSON from stdin, manages state via temp files, evaluates policies in real-time, can block risky tool calls (exit code 2). `wrap` emits real-time events during execution. Helper modules: `format.ts` (output formatting), `git.ts` (git integration), `github.ts` (GitHub API).
- **@agentops/sdk** — Lightweight HTTP client for agent runtimes to talk to the AgentOps server. Depends only on `@agentops/core` for types. Uses native `fetch`. Provides `AgentOpsClient` class (via `createClient()` factory) with methods: `createSession`, `startRun`, `reportAction`, `reportArtifact`, `reportMetrics`, `checkPolicy`, `heartbeat`, `completeRun`, `failRun`. Also exports `PolicyMiddleware` for pre-flight policy checks before actions. Throws typed `AgentOpsError` with status codes.
- **@agentops/web** — Next.js 16 App Router dashboard with React 19, Tailwind CSS 4. API routes under `src/app/api/` organized by resource (runs, sessions, policies, events, analytics, admin, stats, sdk). Jobs, Locks, and Coordination pages were removed from the dashboard because hooks do not populate this data. Sidebar nav: Runs | Sessions | Events | Analytics | Usage | Policies | Settings. Includes inbound SDK routes under `/api/sdk/` for agent runtime communication and mutation routes for dashboard controls (approve/block runs). The Usage page (`/usage`) proxies to the Anthropic Admin API for cost/usage data; requires the `ANTHROPIC_ADMIN_API_KEY` env var. Admin API routes live at `/api/admin/{status,cost,analytics}`. Server components access SQLite directly via a singleton lazy-loaded DB instance (`src/lib/db.ts`). Uses `serverExternalPackages: ["better-sqlite3"]` in next.config.ts. Path alias: `@/*` → `./src/*`. Dark theme by default.

### Core Domain Concepts

**Run** is the central abstraction — an immutable, timestamped record of one autonomous execution containing: Goal, Agents (with roles: Lead/Implementer/Reviewer/CI/Policy), Environment, Actions, Artifacts, Metrics, Evaluations, Decisions, and optional GitHub links. Run modifications always return new objects; never mutate in-place.

**Job** (`core/src/job.ts`) is a dispatchable unit of work. Jobs have priority (Critical/High/Normal/Low), retry policies, and concurrency limits. A Job produces one or more Runs and tracks lifecycle: Queued → Dispatched → Running → Completed/Failed. The **Dispatcher** (`core/src/dispatcher.ts`) provides pure functions for queue ordering, dispatch decisions based on concurrency limits, and session matching.

**Session** (`core/src/session.ts`) represents an agent runtime's lifecycle: Provisioning → Active → Paused → Terminated. Sessions track the current Run being executed, completed Runs, resource usage (memory, CPU, token/cost budgets), and heartbeats for liveness detection.

**Event System** (`core/src/events.ts`) provides a typed event bus. `EVENT_TYPES` defines all events (job.queued, run.started, session.terminated, policy.violated, cost.threshold, etc.). `EventBus` class supports subscribe/unsubscribe/publish with wildcard `"*"` subscriptions. Events are persisted in the `events` table for audit trail. The web SSE endpoint reads from the events table.

**Coordination** (`core/src/coordination.ts`) handles multi-agent resource management. Lock lifecycle (createLock, releaseLock, isLockExpired, isLockHeld), conflict detection (checkConflicts checks for overlapping repo/path/branch locks), branch isolation (generateWorkBranch), and work partitioning (partitionByPath).

**Policy Engine** (`core/src/policy.ts`) evaluates 6 policy types: PathRestriction, FileLimitCount, CostCeiling, RequiredApproval, TestEnforcement, RiskyOpFlag. New policy types must extend the `PolicyConfig` union type.

**Scoring** (`core/src/scoring.ts`) computes a ScoreCard across 5 dimensions (Correctness, RegressionRisk, ScopeRisk, PolicyCompliance, Unknowns) as 0–1 ratios, producing a MergeRecommendation of Merge | Block | Review.

**Session Summary** (`core/src/summary.ts`) generates a structured `SessionSummary` from a completed Run. Includes: headline (one-line glanceable summary), outcome, files changed (created/modified/deleted), command highlights, cost, action counts by type, policy compliance, and score. Generated deterministically (template-based, no LLM). Summaries are persisted as JSON on the run record and surfaced as the primary view in the dashboard.

**Orchestrator** (`core/src/orchestrator.ts`) ties Jobs, Sessions, and Events together. Provides `submitAndQueueJob`, `dispatchNextJob`, `startJobExecution`, `completeJobExecution`, `failJobExecution`, `terminateSessionGracefully`, `cleanupStaleSessions`, and `cleanupExpiredLocks`. These are the high-level operations that CLI and web call into.

### Key Conventions

- TypeScript 5.7 strict mode, ES2022 target, bundler module resolution, `noUncheckedIndexedAccess` enabled
- Always use branded ID constructors (`createRunId()`, `createJobId()`, `createSessionId()`, etc.) — never raw strings for IDs
- Immutable builder pattern: all state transitions return new objects via spread (see `run.ts`, `job.ts`, `session.ts`)
- Repository pattern: all DB functions take `(db: AgentOpsDb, ...)` as first arg, named `insertX`, `getX`, `listX`, `updateX`
- Tests colocated in `src/__tests__/` directories, pattern `*.test.ts`
- Web API routes use `force-dynamic` to ensure fresh data on every request
- CLI commands registered via `registerXCommands(program)` pattern in `cli/src/index.ts`
- CLI auto-detects git repo/branch; can override with `--repo` and `--branch` flags
- DB defaults to `~/.agentops/agentops.db`; override with `AGENTOPS_DB_PATH` env var or `--db-path` CLI flag
- DB uses WAL mode with foreign keys enforced; migrations are programmatic (`CREATE TABLE IF NOT EXISTS`)
- ESLint is only configured in the web package (flat config format in `eslint.config.mjs`); core, db, and cli have no linter

### Environment Variables

- `AGENTOPS_DB_PATH` — Override default SQLite database location (`~/.agentops/agentops.db`)
- `ANTHROPIC_ADMIN_API_KEY` — Anthropic Admin API key for the Usage page. Set before starting the dashboard (`agentops serve`) to enable cost/usage tracking from the Anthropic API. Obtain from the Anthropic Console under Organization Settings.
