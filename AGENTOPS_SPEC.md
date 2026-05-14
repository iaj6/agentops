# AgentOps

**The control plane for autonomous AI coding agents.**

AgentOps is a self-hosted governance and observability layer for AI agents that write code — Claude Code today, other runtimes via SDK. It sits between your developers and the agent runtime: every tool call the agent attempts is intercepted, evaluated against your policies, and either allowed, blocked, or flagged. Every session produces a structured, human-readable summary with a merge recommendation backed by an explicit scorecard.

It does not replace the agent runtime. It wraps it.

---

## The problem

AI agents can now write code, run commands, edit files, open PRs. The capability is here. The governance is not.

Engineering leaders supporting agent-driven development are answering the same questions repeatedly and without good tools:

- **What did the agent actually do in that session?** Reading raw logs or git diffs after the fact is not a review process.
- **Did it stay inside the rails we set?** Path scope, branch protections, dangerous commands, blocked tools — none of this is enforced unless something stops the agent at the moment it tries.
- **How much is this costing us, and per what?** Anthropic's Admin API gives you org-level spend. It does not see Bedrock traffic. It cannot attribute spend to a session, a developer, a repo, or a task. It cannot stop a runaway loop before it spends the money.
- **Should we merge this?** Reviewing autonomous output is a different shape of problem than reviewing a human PR — the reviewer needs to know what the agent attempted, what it skipped, what it touched outside scope, and what it claims it tested.

AgentOps addresses all four directly. Autonomy without guardrails is not velocity; it is liability.

---

## What it does

### 1. Real-time policy enforcement

Policies are evaluated **before** the agent's tool call executes. Violations of `Guard` policies cause the tool call to be blocked at the runtime layer — the agent receives a denial and continues, the action never happens.

Enforced policy types:

| Policy | What it stops |
|---|---|
| **PathRestriction** | Edits to specified paths or globs (e.g. `infra/**`, `.github/**`) |
| **BranchProtection** | Any mutation while checked out on `main`, `release/*`, etc. |
| **ToolRestriction** | Specific tools the agent isn't allowed to use (e.g. `WebFetch`, `Bash`) |
| **RiskyOpFlag** | Commands matching configured patterns (`rm -rf`, `force push`, `DROP TABLE`) |
| **SecretDetection** | File writes containing secret-shaped strings |
| **FileLimitCount** | Sessions that touch more files than a configured ceiling |
| **CostCeiling** | The next tool call would push cumulative spend over the limit |

Two additional categories run as `Check` (post-hoc, surfaced on the run rather than blocking): **TestEnforcement** (did the agent run tests, do they pass) and the scorecard dimensions below.

### 2. Backend-agnostic cost enforcement

CostCeiling is the differentiating capability and worth calling out.

Token usage data is read from the **client-side transcript** the agent runtime writes locally, not from a billing API. The transcript contains a full `usage` block per assistant turn — input tokens, output tokens, cache creation, cache reads, model identifier — regardless of whether the request was routed to Anthropic direct, AWS Bedrock, or GCP Vertex.

Implication: AgentOps enforces a hard dollar ceiling on agent spend before the money is spent, and it does so uniformly across backends. Bedrock customers in particular have no other path to this — Bedrock spend lives in CloudWatch and Cost Explorer with IAM-principal attribution, no session concept, and no ability to halt a run mid-flight.

A maintained model→price table ships in-tree for both Anthropic direct and Bedrock rates, with separate handling for cache-read and cache-creation token classes.

### 3. Session summaries

Every completed run produces a `SessionSummary` — generated deterministically from the run record, no LLM in the loop. The summary includes:

- A one-line headline ("Fixed null-pointer in auth middleware; 4 files changed; 12/12 tests passing").
- Outcome (`success | failure | blocked | cancelled`).
- Files created / modified / deleted, listed.
- Command highlights (trivial commands filtered).
- Cost breakdown (USD, input/output tokens, backend).
- Action counts by type.
- Policy compliance: total, passed, violated, with violation reasons.
- Scorecard with merge recommendation.

These are the primary review surface in the dashboard, replacing "scroll through a 2,000-line transcript" as the artifact a human acts on.

### 4. Merge recommendation scorecard

Each run is scored across five dimensions (0–1, with rationale):

- **Correctness** — test pass rate
- **Regression risk** — failing tests and historical flake rate
- **Scope risk** — file-count footprint vs configured thresholds
- **Policy compliance** — violation count weighted by severity
- **Unknowns** — explicit accounting for what the agent didn't verify

The dimensions collapse to a recommendation: **Merge**, **Review**, or **Block**. The point is not to auto-merge; it is to give a reviewer a defensible starting position and an audit trail.

### 5. Real-time observability

A web dashboard (Next.js) shows live runs, sessions, events, analytics, usage, and policy state. Events flow through a typed event bus and are persisted to an append-only event table, giving you a queryable audit trail of every action every agent took.

Sections:

- **Runs** — every agent execution, drilldown to actions, artifacts, policy results, score
- **Sessions** — agent runtime lifecycles, current run, completed runs, resource use
- **Events** — streaming feed; the same data drives webhooks and SSE for external integrations
- **Analytics** — aggregates across runs and sessions
- **Usage** — cost and token consumption, including Anthropic Admin API rollups where available
- **Policies** — definitions, severity, scope; live state of what's enforced

---

## How it integrates

AgentOps wraps the agent runtime through the runtime's native hook mechanism. For Claude Code, that means the Claude Code hook protocol — `SessionStart`, `PreToolUse`, `PostToolUse`, `SessionEnd`, and the sub-agent variants. The `agentops setup` command configures these hooks for you, either project-scoped or globally.

When the agent attempts a tool call:

1. Claude Code invokes the AgentOps hook handler over stdin with the tool name and arguments.
2. The handler resolves the active run, evaluates all applicable Guard policies.
3. A violation exits with code `2`, which Claude Code interprets as a denial and surfaces back to the agent.
4. Otherwise the call proceeds; the handler records the action and updates the run.

For agent runtimes other than Claude Code, the **`@agentops/sdk`** package exposes a thin HTTP client (`createSession`, `startRun`, `reportAction`, `checkPolicy`, `completeRun`, etc.). Any runtime that can make HTTP calls before executing a tool can use AgentOps as its enforcement plane.

The integration surface is intentionally small. AgentOps does not require modifying the agent. It does not require a proxy. It does not need access to API keys.

---

## Deployment model

AgentOps is **self-hosted**. The customer runs the dashboard inside their own perimeter and points developer CLIs at it.

- **Server**: a single Node.js process that serves the Next.js dashboard and the HTTP API. SQLite by default for storage; backed by Drizzle ORM so a Postgres path is straightforward when scale demands it.
- **CLI**: developers install `@agentops/cli` and run `agentops login`, which performs an OAuth-style device-authorization grant against the dashboard, then `agentops setup` to install the hooks.
- **Auth**: every API route is bearer-token-authenticated; tokens are issued per user and scoped per machine.
- **Multi-user**: every session, run, action, and event is attributed to a user. The dashboard supports a per-user view and a team view.
- **No outbound dependencies required**: the system functions entirely against transcript files and hook events. Optional enrichment from the Anthropic Admin API requires `ANTHROPIC_ADMIN_API_KEY`.
- **Containerized install**: ships with `docker compose` for the trial install path. A fresh-machine smoke test takes minutes.

The operational footprint is one container, one volume, one port. No queue, no broker, no external state store.

---

## What this replaces / what it does not

**Replaces:**
- "Read the agent's transcript after the fact" as a review process.
- Ad-hoc shell wrappers that try to block dangerous commands per-developer.
- Spreadsheet-style cost tracking across direct Anthropic, Bedrock, Vertex traffic.
- The hope that a `.cursorrules`-style instruction is enough to keep an agent inside scope.

**Does not replace:**
- The agent runtime itself.
- Your CI / your test runner / your code review tool.
- Your IDP. AgentOps has its own user model for the trial; SSO is a near-term roadmap item, not a current capability.
- Anthropic's Admin API for org-level billing reconciliation; AgentOps complements it with per-session attribution and pre-spend enforcement.

---

## Architecture

Five-package npm workspaces monorepo:

```
core  ←  db   ←  cli
            ←  web
      ←  sdk
```

| Package | Role |
|---|---|
| `@agentops/core` | Domain model, policy engine, scoring, pricing table, summary generator. Zero external dependencies. |
| `@agentops/db` | Persistence. Drizzle ORM over SQLite (better-sqlite3). Repository functions per table. |
| `@agentops/cli` | The `agentops` binary — `init`, `login`, `setup`, `serve`, `hook`, `run`, `policy`, `report`. |
| `@agentops/sdk` | HTTP client for agent runtimes outside Claude Code. Native `fetch`, typed errors. |
| `@agentops/web` | Next.js 16 / React 19 dashboard plus inbound SDK API routes. |

Core invariants worth knowing as an evaluator:

- TypeScript strict mode, branded ID types, immutable run builders — state transitions return new objects.
- The policy engine and scoring algorithm have zero IO and zero framework dependencies. They are unit-tested as pure functions.
- Cost computation is centralized in one pricing table and tested against real transcripts.
- Hooks fail open by default on infrastructure errors (logging is recorded), and fail closed only on a confirmed policy violation. The agent runtime is never left in a wedged state by AgentOps being unhealthy.

---

## What you control

| Control surface | Mechanism |
|---|---|
| Which policies are enforced | Policy table in the dashboard; CLI `policy` commands; seeded defaults available |
| Per-policy severity | Error / Warning / Info, configurable per policy |
| Scope of enforcement | Per-repo, per-branch, per-user (planned), or global |
| Hooks installed where | `agentops setup` (project) or `agentops setup --global` (`~/.claude/settings.json`) |
| Backend pricing | In-tree price table; override per deployment for Bedrock regions or enterprise rates |
| Token storage location | `~/.agentops/credentials.json` (file mode `0600`) |
| DB location | `AGENTOPS_DB_PATH` env var or `--db-path` flag |

---

## Concrete pitch for the trial

A team running Claude Code through Bedrock today has:

- No way to stop a developer's session from spending $400 on a single task.
- No per-developer attribution of that spend.
- No way to prevent the agent from touching the `infrastructure/` directory.
- No way to enforce that tests were run before a PR was opened.
- No structured artifact to review other than a transcript dump.

AgentOps, installed:

- One container running inside the customer's network.
- `agentops setup --global` on each developer's laptop, one `agentops login` per developer.
- A `CostCeiling` policy at $50/run and a `PathRestriction` policy covering `infrastructure/**`.

The day-one outcome is that every Claude Code session in the org shows up on a shared dashboard with attribution, a session summary, a merge recommendation, and a hard ceiling on what any one session can spend. The cost of that outcome to the customer is one VM, one port, and a five-minute install per developer.

---

## License

MIT.
