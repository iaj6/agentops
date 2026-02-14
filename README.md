# AgentOps

**The control plane for autonomous AI agents.**

<!-- Badges: uncomment when published -->
<!-- [![npm version](https://img.shields.io/npm/v/@agentops/cli)](https://www.npmjs.com/package/@agentops/cli) -->
<!-- [![tests](https://github.com/agentops-ai/agentops/actions/workflows/test.yml/badge.svg)](https://github.com/agentops-ai/agentops/actions) -->
<!-- [![license](https://img.shields.io/npm/l/@agentops/cli)](./LICENSE) -->

AgentOps observes what AI coding agents do, enforces policies, scores outcomes, and produces human-readable session summaries. It wraps agent runtimes like Claude Code — it does not replace them. Local-first, backed by SQLite.

## Quick Start

```bash
npm install -g @agentops/cli

agentops init
agentops setup --global
agentops serve
```

Now use Claude Code normally. Every session is automatically tracked. Open [http://localhost:3000](http://localhost:3000) to see your dashboard.

## Why

AI agents can write code, fix bugs, and ship features. But no one can answer basic questions about their work: what did it do, did it follow our rules, how much did it cost, and should we merge this? AgentOps adds the governance layer. Autonomy without guardrails is not velocity — it is liability.

## What You Get

- **Session summaries** -- human-readable reports of what each agent session did
- **Real-time monitoring** -- live dashboard updates as agents work
- **Policy enforcement** -- block risky operations before they happen (path restrictions, cost ceilings, dangerous commands)
- **Scoring** -- automated merge recommendations based on test results, scope, and policy compliance
- **Cost tracking** -- per-session and per-run cost breakdowns

<!-- TODO: Add dashboard screenshot -->

## Architecture

Five-package npm workspaces monorepo:

```
core  <-- db  <-- cli
               <-- web
      <-- sdk
```

| Package | Description |
|---------|-------------|
| `@agentops/core` | Domain types, policy engine, scoring algorithm. Zero dependencies. |
| `@agentops/db` | SQLite persistence via Drizzle ORM. |
| `@agentops/cli` | CLI entry point. Hooks into Claude Code, manages sessions, serves dashboard. |
| `@agentops/sdk` | Lightweight HTTP client for custom agent runtimes. |
| `@agentops/web` | Next.js dashboard with real-time updates. |

See [CLAUDE.md](./CLAUDE.md) for detailed architecture, domain concepts, and conventions.

## SDK for Custom Agents

If you are building your own agent runtime, use the SDK to report activity to AgentOps:

```typescript
import { createClient } from '@agentops/sdk';

const client = createClient({ baseUrl: 'http://localhost:3000' });

const session = await client.createSession({ agent: 'my-agent' });
const run = await client.startRun({
  goal: { summary: 'Fix auth bug' },
  sessionId: session.id,
});

await client.reportAction(run.id, { type: 'FileEdit', path: 'src/auth.ts' });
await client.reportMetrics(run.id, { tokensUsed: 1200, cost: 0.04 });
await client.completeRun(run.id);
```

## CLI Reference

```bash
agentops init              # Bootstrap database
agentops init --seed       # Bootstrap with sample data
agentops init --clean      # Reset database
agentops setup             # Configure Claude Code hooks (project-level)
agentops setup --global    # Configure hooks globally
agentops setup --uninstall # Remove hooks
agentops serve             # Start dashboard (default: port 3000)
agentops wrap "command"    # Wrap a command with real-time event streaming
```

Run any command with `--help` for details, or `--json` for machine-readable output.

## Development

```bash
git clone https://github.com/agentops-ai/agentops
cd agentops
npm install
npm run build
npm run test
npm run dev    # Dashboard at localhost:3000
```

Requires Node.js >= 20. Tests use Vitest. The web package uses Next.js 16 with React 19.

## License

MIT
