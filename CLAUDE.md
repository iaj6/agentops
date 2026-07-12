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
agentops init --clean      # Reset DB to empty
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
- **@agentops/db** — SQLite persistence via Drizzle ORM + better-sqlite3. Sixteen tables: `runs`, `policies`, `policy_results`, `run_metrics`, `jobs`, `sessions`, `events`, `locks`, `users`, `api_tokens`, `auth_sessions`, `device_codes`, `webhooks`, `webhook_deliveries`, `audit_log`, `user_budgets`. Complex fields stored as JSON columns. DB defaults to `~/.agentops/agentops.db` (override with `AGENTOPS_DB_PATH`). WAL mode with `foreign_keys = ON` — deletes of parent rows must cascade children first (see `deletePolicy`, `deleteOldRuns`).
- **@agentops/cli** — CLI entry point (`agentops`). Commands: `init`, `serve`, `setup`, `hook`, `login`, `doctor`, `user`, `admin`, `cleanup`, `run`, `policy`, `report`, `wrap`, `watch`, `link`, `pr`, `job`, `session`, `events`, `lock`, `dispatch`. Supports `--json` output and `--db-path` override. `init` bootstraps the DB (`--seed` for sample data, `--seed-policies` for the starter policy set, `--clean` to reset). `serve` starts the dashboard server (`--port` to override 3000). `setup` configures Claude Code hooks (`--global`, `--uninstall`, `--dry-run`). `hook` handles Claude Code hook events (session-start, pre-tool-use, post-tool-use, user-prompt-submit, stop, subagent-stop, session-end) — reads JSON from stdin, manages state under `~/.agentops/state/`, evaluates policies in real-time, can block risky tool calls (exit code 2), and reads cost/token usage from the Claude Code transcript (deduped by `message.id`; unknown models warn on stderr instead of pricing at $0). `login` runs the device-flow auth against a dashboard; `doctor` diagnoses a local install. Helper modules: `format.ts` (output formatting), `git.ts` (git integration), `github.ts` (GitHub API), `transcript.ts` (usage/cost from Claude Code transcripts), `pricing` lives in core. Note: `job`, `lock`, `dispatch`, `wrap`, and `watch` operate on orchestration machinery that Claude Code hooks never populate — treat them as experimental/vestigial.
- **@agentops/sdk** — Lightweight HTTP client for agent runtimes to talk to the AgentOps server. Depends only on `@agentops/core` for types. Uses native `fetch`. Provides `AgentOpsClient` class (via `createClient()` factory) with methods: `createSession`, `startRun`, `reportAction`, `reportArtifact`, `reportMetrics`, `checkPolicy`, `heartbeat`, `completeRun`, `failRun`. Also exports `PolicyMiddleware` for pre-flight policy checks before actions. Throws typed `AgentOpsError` with status codes.
- **@agentops/web** — Next.js 16 App Router dashboard with React 19, Tailwind CSS 4. API routes under `src/app/api/` organized by resource (runs, sessions, policies, events, analytics, admin, stats, sdk, auth, budgets, webhooks). Jobs, Locks, and Coordination pages were removed from the dashboard because hooks do not populate this data. Sidebar nav: Runs | Sessions | Events | Analytics | Usage | Policies | Settings. **Every API route is authenticated** (`src/lib/auth.ts`): bearer tokens or session cookies, `admin`/`member` roles, members are scoped to their own runs/sessions (`resolveViewScope`), non-owners get 404 (not 403) to avoid ID enumeration, mutations additionally pass `checkSameOrigin` CSRF checks — new routes must follow this pattern (regression tests live in `api/__tests__/auth-gaps.test.ts`). Inbound SDK routes under `/api/sdk/` use bearer auth + per-token rate limits. The Usage page (`/usage`) always shows the local hook-captured rollup (incl. Bedrock-vs-direct backend split and per-user attribution); when `ANTHROPIC_ADMIN_API_KEY` is set it additionally shows org-wide cost/tokens via `/api/admin/{status,cost,analytics}`, which normalize the Anthropic Admin API's reports (RFC 3339 `starting_at`, paginated, amounts are decimal-string cents) server-side. Server components access SQLite directly via a singleton lazy-loaded DB instance (`src/lib/db.ts`). Uses `serverExternalPackages: ["better-sqlite3"]` in next.config.ts. Path alias: `@/*` → `./src/*`. Dark theme by default.

### Core Domain Concepts

**Run** is the central abstraction — an immutable, timestamped record of one autonomous execution containing: Goal, Agents (with roles: Lead/Implementer/Reviewer/CI/Policy), Environment, Actions, Artifacts, Metrics, Evaluations, Decisions, and optional GitHub links. Run modifications always return new objects; never mutate in-place.

**Job** (`core/src/job.ts`) is a dispatchable unit of work. Jobs have priority (Critical/High/Normal/Low), retry policies, and concurrency limits. A Job produces one or more Runs and tracks lifecycle: Queued → Dispatched → Running → Completed/Failed. The **Dispatcher** (`core/src/dispatcher.ts`) provides pure functions for queue ordering, dispatch decisions based on concurrency limits, and session matching. ⚠️ **Vestigial:** nothing in the hook-driven product path creates Jobs or dispatches them (hook-created sessions always carry a `currentRunId`, so `matchSession` can never select one); this layer is exercised only by its own tests and the experimental `job`/`dispatch` CLI commands.

**Session** (`core/src/session.ts`) represents an agent runtime's lifecycle: Provisioning → Active → Paused → Terminated. Sessions track the current Run being executed, completed Runs, resource usage (memory, CPU, token/cost budgets), and heartbeats for liveness detection.

**Event System** (`core/src/events.ts`) provides a typed event bus. `EVENT_TYPES` defines all events (job.queued, run.started, session.terminated, policy.violated, cost.threshold, etc.). `EventBus` class supports subscribe/unsubscribe/publish with wildcard `"*"` subscriptions. Events are persisted in the `events` table for audit trail. The web SSE endpoint reads from the events table.

**Coordination** (`core/src/coordination.ts`) handles multi-agent resource management. Lock lifecycle (createLock, releaseLock, isLockExpired, isLockHeld), conflict detection (checkConflicts checks for overlapping repo/path/branch locks), branch isolation (generateWorkBranch), and work partitioning (partitionByPath). ⚠️ **Vestigial:** locks are only ever created via the experimental `lock` CLI command; no runtime path uses them.

**Policy Engine** (`core/src/policy.ts`) evaluates 8 policy types: PathRestriction, FileLimitCount, TestEnforcement, RiskyOpFlag, SecretDetection, BranchProtection, ToolRestriction, CostCeiling. Policies run in two modes: **guard** (`evaluatePreToolPolicies` — real-time, called from the PreToolUse hook, can block a tool call) and **check** (post-hoc evaluation of a completed Run). New policy types must extend the `PolicyConfig` union type and usually need both a guard and a check implementation.

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
- Every web API route authenticates via `src/lib/auth.ts` helpers (`requireUser`/`requireAdmin`/`requireOwnedRun`); mutations also call `checkSameOrigin`. Add coverage to `auth-gaps.test.ts` when adding routes
- Web tests import `@agentops/core`/`db` from their built `dist/` — after switching branches or editing core/db, run root `npm run build` first or web tests will exercise stale code
- CLI commands registered via `registerXCommands(program)` pattern in `cli/src/index.ts`
- CLI auto-detects git repo/branch; can override with `--repo` and `--branch` flags
- DB defaults to `~/.agentops/agentops.db`; override with `AGENTOPS_DB_PATH` env var or `--db-path` CLI flag
- DB uses WAL mode with foreign keys enforced; migrations are programmatic (`CREATE TABLE IF NOT EXISTS`)
- ESLint is only configured in the web package (flat config format in `eslint.config.mjs`); core, db, and cli have no linter

### Environment Variables

- `AGENTOPS_DB_PATH` — Override default SQLite database location (`~/.agentops/agentops.db`)
- `AGENTOPS_FAIL_CLOSED` — Set to `1`/`true` to make hooks block tool calls when enforcement can't be verified (offline dashboard, rejected token). Default is fail-open so AgentOps never bricks a working Claude Code session.
- `CLAUDE_CODE_USE_BEDROCK` — Read (not set) by the hooks to tag a session's spend as `bedrock` vs direct `anthropic` for the Usage page's backend split.
- `ANTHROPIC_ADMIN_API_KEY` — Anthropic Admin API key for the org-wide half of the Usage page. Set before starting the dashboard (`agentops serve`). Obtain from the Anthropic Console under Organization Settings. Model pricing for the local rollup lives in `core/src/pricing.ts` (`ANTHROPIC_PRICING`) — **it must be refreshed when new Claude models ship**, or their sessions warn on stderr and record $0.
