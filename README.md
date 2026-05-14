# AgentOps

**The control plane for autonomous AI coding agents.**

AgentOps is a self-hosted governance and observability layer for AI agents that
write code — Claude Code today, other runtimes via SDK. It sits between your
developers and the agent runtime: every tool call the agent attempts is
intercepted, evaluated against your policies, and either allowed, blocked, or
flagged. Every session produces a structured, human-readable summary with a
merge recommendation backed by an explicit scorecard.

It does not replace the agent runtime. It wraps it.

---

## What you get

- **Real-time policy enforcement.** Path restrictions, branch protection,
  cost ceilings, secret detection, tool restrictions, risky-command flagging.
  Violations block the tool call at the runtime layer — the agent receives a
  denial and continues, the action never happens.
- **Cost control that works on Bedrock.** The Anthropic Admin API doesn't see
  AWS Bedrock traffic. AgentOps reads token usage from the Claude Code
  transcript on the developer's machine and enforces a per-session ceiling
  before spend happens. Backend-agnostic.
- **Multi-user dashboard.** Each developer logs in with their own credentials
  via an OAuth-style device flow. Runs are tagged with the owner. Admins see
  the team; members see their own.
- **Session summaries.** Files changed, commands run, cost, policy outcomes,
  and a merge / review / block recommendation — produced from the run state,
  not an LLM.
- **Self-hosted.** Single Docker image, single SQLite database, no external
  dependencies. Backup is copying one file.

---

## Architecture in 30 seconds

```
+---------------------+         HTTPS         +-----------------------+
| Developer machine   |  Bearer token (per    | Dashboard (self-host)  |
| - Claude Code        |  user, from           | - Next.js + SQLite     |
| - agentops CLI       |  agentops login)      | - /api/sdk/* writes    |
| - hooks send events  | --------------------> | - /api/auth/* device   |
| - transcript on disk |                       |   flow + cookie login  |
+---------------------+                       +-----------------------+
```

The dashboard is the source of truth. Multiple developers point their CLIs at
one dashboard. Each developer authenticates once via `agentops login` and from
that moment on every Claude Code session they run reports to the dashboard
tagged with their identity. Policies are configured in the dashboard, applied
on every tool call.

A local-only "single user, single machine" mode is also supported — useful for
dogfooding and for testing AgentOps before deploying the dashboard. Hooks fall
back to a local SQLite database when no dashboard is configured.

---

## Quick start: self-host the dashboard

You need Docker + Docker Compose.

```bash
git clone https://github.com/agentops-ai/agentops
cd agentops

docker compose up -d                    # build + start
docker compose exec dashboard \
  agentops user add ian@example.com     # bootstrap your first admin
```

The user-add command prints a one-time temp password. Open
[http://localhost:3000/login](http://localhost:3000/login) in your browser,
sign in, change the password.

By default the dashboard binds to `127.0.0.1` (the API is currently unauth'd
at the network level — auth is per-request, via Bearer tokens or cookies). To
make the dashboard reachable on your LAN, edit the `ports:` block in
`docker-compose.yml`. For internet exposure put a reverse proxy in front that
terminates TLS.

Persistent data lives in `./agentops-data/` next to `docker-compose.yml`. Back
up that directory to back up the dashboard.

### Optional: Anthropic Admin API for org-wide cost data

The Usage page surfaces org-level cost and per-message usage by proxying to
the Anthropic Admin API. Get an admin key from console.anthropic.com, then:

```bash
echo "ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-..." > .env
docker compose up -d                    # restart picks up the new env
```

The variable is referenced from `docker-compose.yml` and is **only** read by
the dashboard. It does not need to be on developer machines.

### Production deployment with HTTPS

The default `docker compose up -d` binds the dashboard to `127.0.0.1:3000` —
fine for "ssh tunnel to my laptop" but not for a real team. For an internet-
facing or LAN-facing deployment, run with the `production` profile, which
adds a Caddy sidecar that terminates TLS and reverse-proxies to the dashboard
over the internal docker network.

**Prerequisites:**
1. **DNS** pointing at the host (e.g. `agentops.acme.com A 1.2.3.4`).
2. **Ports 80 and 443** reachable from the public internet so Let's Encrypt
   can complete the HTTP-01 challenge.
3. **Email** to register with Let's Encrypt (optional but recommended — they
   email if certs ever fail to renew).

**Configure `.env`:**

```bash
AGENTOPS_HOSTNAME=agentops.acme.com
LETSENCRYPT_EMAIL=ops@acme.com
```

**Start:**

```bash
docker compose --profile production up -d
```

Caddy auto-provisions a Let's Encrypt cert on first request. Subsequent
restarts reuse the cert from the `caddy-data` named volume — back that
volume up alongside `./agentops-data/` to survive `docker compose down -v`.

**Verify from a dev machine:**

```bash
agentops login --server https://agentops.acme.com
agentops doctor
```

The doctor should report ✓ for dashboard reachability and token validity.

**Testing without burning Let's Encrypt rate limits:**

```bash
# In .env
AGENTOPS_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

Staging issues untrusted certs that browsers warn about, but it lets you
verify the full flow without using your production cert quota.

**No public DNS? Use Caddy's internal CA.**

If you're deploying on a LAN without a public hostname (e.g.
`https://agentops.internal`), edit `Caddyfile` and replace the site block:

```caddy
https://agentops.internal {
    tls internal
    reverse_proxy dashboard:3000
}
```

Devs need to trust Caddy's local root CA — see
<https://caddyserver.com/docs/automatic-https#local-https> for the
platform-specific commands.

### Optional: continuous backup to S3 with Litestream

The dashboard's whole state is a single SQLite file at
`./agentops-data/agentops.db`. For point-in-time recovery and disaster
durability, run the Litestream sidecar which streams every WAL frame to an
S3 bucket (or any S3-compatible store like MinIO, R2, Wasabi):

```bash
# .env (next to docker-compose.yml)
AGENTOPS_S3_BUCKET=my-agentops-backups
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

docker compose --profile backup up -d
docker compose --profile backup logs -f litestream  # confirm "wal segment written"
```

Retention defaults to 14 days. The cost is in cents per month at the volumes
AgentOps generates. See `litestream.yml` to tune.

### Disaster recovery

If you ever lose `./agentops-data/` (disk failure, fat-fingered `rm`, host
gone), restore from S3:

```bash
# 1. Stop the dashboard so nothing tries to use the empty DB.
docker compose stop dashboard

# 2. Wipe whatever is left of the broken DB.
rm -f ./agentops-data/agentops.db*

# 3. Restore the latest backup.
docker run --rm \
  -v "$(pwd)/agentops-data:/data" \
  -v "$(pwd)/litestream.yml:/etc/litestream.yml:ro" \
  --env-file .env \
  litestream/litestream:0.5.0 \
  restore -config /etc/litestream.yml /data/agentops.db

# 4. Start everything back up. Existing user accounts, tokens, runs, and
#    policies are all back. Active hook sessions on developer machines will
#    fail-open until they fire a new event.
docker compose --profile backup up -d
```

For older points in time, add `-timestamp <RFC3339>` to the `restore`
command. See `litestream restore -h` for options.

---

## Quick start: developer machine

Each developer installs the CLI on their own laptop. The CLI sends events to
the dashboard via HTTPS using a per-user bearer token issued by the device
authorization flow.

```bash
# 1. Get the CLI. (npm publish is on the roadmap; for now, from source.)
git clone https://github.com/agentops-ai/agentops
cd agentops
npm install
npm run build
npm link --workspaces                   # makes the `agentops` command global

# 2. Sign in to your team's dashboard.
agentops login --server https://agentops.acme.internal
# Opens a URL in your browser. Approve. CLI receives a long-lived token,
# stores it at ~/.agentops/credentials.json (mode 0600).

# 3. Wire Claude Code hooks to AgentOps.
agentops setup
# Detects your login from step 2 and bakes the dashboard URL into the hook
# command. Project-level by default — pass --global to wire all projects.
```

That's it. Start Claude Code from any project; every session reports to the
dashboard. Open the dashboard and your runs show up tagged with your user.

`agentops whoami` confirms you're signed in. `agentops logout` clears the
credentials file.

---

## What gets enforced

Policies are configured in the dashboard (Policies tab). Each policy is one
of these types and lands in one of two modes:

| Policy | What it stops | Mode |
|---|---|---|
| **PathRestriction** | Edits to specified paths (e.g. `infra/**`, `.github/**`) | Guard (blocks the tool call) |
| **BranchProtection** | Any mutation while checked out on `main`, `release/*`, etc. | Guard |
| **ToolRestriction** | Specific tools the agent isn't allowed to use (e.g. `WebFetch`) | Guard |
| **RiskyOpFlag** | Commands matching patterns (`rm -rf`, `force push`, `DROP TABLE`) | Guard |
| **SecretDetection** | File writes containing secret-shaped strings | Guard |
| **FileLimitCount** | Sessions touching more than N files | Guard |
| **CostCeiling** | Session token spend exceeding $N (transcript-driven, works on Bedrock) | Guard |
| **TestEnforcement** | Sessions completed without passing tests | Check (informational on the run summary) |

Guard policies block tool calls at the agent runtime layer before the action
happens. Check policies are evaluated when the run completes and surface on
the session summary.

### Outbound webhooks

Configure webhook receivers in **Settings → Webhooks** to get an HMAC-signed
POST every time a policy is violated. The dashboard issues a signing secret
on create (shown once); use it to verify the `X-AgentOps-Signature` header
on incoming requests.

Each delivery includes:

```
POST <your-url>
Content-Type: application/json
X-AgentOps-Signature: sha256=<hex>
X-AgentOps-Event: policy.violated
X-AgentOps-Delivery-Id: <event-id>

{
  "id": "evt_...",
  "type": "policy.violated",
  "timestamp": "2026-05-14T12:00:00.000Z",
  "data": { "runId": "...", "policy": "...", "message": "..." }
}
```

Receivers should verify the signature by computing
`sha256=<HMAC-SHA256(secret, raw-body)>` and comparing constant-time. The
dispatcher retries once on 5xx / 429 (30s gap) and surfaces every attempt
in the dashboard's per-webhook delivery log.

---

## CLI reference

```bash
# Admin (run on the dashboard host or any box with --db-path)
agentops user add <email>           # create a user; prints a temp password
agentops user list                  # list users
agentops user reset-password <email> # rotate a user's password

# Per-developer (after agentops login)
agentops login --server <url>       # OAuth-style device flow
agentops logout                     # remove ~/.agentops/credentials.json
agentops whoami                     # show signed-in user
agentops setup                      # wire Claude Code hooks
agentops setup --server <url>       # override dashboard URL
agentops setup --local              # force direct-SQLite mode
agentops setup --uninstall          # remove hooks

# Local-only mode (no dashboard)
agentops init                       # bootstrap a local SQLite db
agentops init --seed                # with fake demo data (runs/sessions/events)
agentops init --seed-policies       # install the curated starter policy set
agentops serve                      # local dashboard at 127.0.0.1:3000
```

The starter policy set is 7 conservative defaults: a $25 session cost ceiling,
branch protection on `main`/`master`, secret detection (AWS keys, PEM keys,
generic `api_key`/`token` assignments), risky-op flags for `rm -rf` and force
push, a tool restriction blocking `WebFetch`/`WebSearch`, and a 50-file
per-session cap. Loading is idempotent — re-running silently skips any
already-installed entries. Admins can also load them from the dashboard's
**Policies → Load starter policies** button when the table is empty.

Every command accepts `--json` for machine-readable output. Most accept
`--db-path` to point at a specific SQLite file (otherwise `AGENTOPS_DB_PATH`
or `~/.agentops/agentops.db`).

---

## Architecture

```
core  <-- db  <-- cli
               <-- web
      <-- sdk
```

| Package | Description |
|---|---|
| `@agentops/core` | Domain types, policy engine, scoring, pricing. No external deps. |
| `@agentops/db` | SQLite persistence via Drizzle ORM. |
| `@agentops/cli` | CLI entry point + Claude Code hook handlers. |
| `@agentops/sdk` | Typed HTTP client for custom agent runtimes. |
| `@agentops/web` | Next.js 16 dashboard with cookie + bearer auth. |

See [CLAUDE.md](./CLAUDE.md) for detailed architecture and conventions, and
[AGENTOPS_SPEC.md](./AGENTOPS_SPEC.md) for the product spec.

---

## Custom agent runtimes (SDK)

If you're building your own agent runtime (not Claude Code), use the SDK to
report activity. Authenticate the same way — issue a token via the dashboard,
pass it as a Bearer header.

```typescript
import { createClient } from "@agentops/sdk";

const client = createClient({
  baseUrl: "https://agentops.acme.internal",
  apiKey: process.env.AGENTOPS_API_KEY,
});

const session = await client.createSession({ agentId: "my-agent" });
const run = await client.startRun({
  goal: { humanReadable: "Fix the auth bug" },
  environment: { repo: "acme/backend", branch: "fix/auth", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
  sessionId: session.id,
});

// Before each tool call:
const decision = await client.checkPolicy({
  runId: run.id,
  toolName: "Bash",
  toolInput: { command: "rm -rf /tmp/x" },
  cumulativeCostUsd: 1.23,
});
if (decision.decision === "block") { /* deny */ }

await client.reportAction(run.id, { /* ... */ });
await client.reportMetrics(run.id, { costUsd: 1.5, tokenUsage: { /* ... */ } });
await client.completeRun(run.id);
```

---

## Development

```bash
git clone https://github.com/agentops-ai/agentops
cd agentops
npm install
npm run build
npm run test
npm run dev    # dashboard at localhost:3000
```

Requires Node.js >= 20. Tests use Vitest. The web package uses Next.js 16 +
React 19. The dashboard's standalone build is verified by `docker build .`.

---

## Troubleshooting

**First stop:** `agentops doctor`. Runs the diagnostic checklist: credentials,
dashboard reachability, hook installation, recent activity, outbox state.
Tells you what's wrong + the exact command to fix it. Use `--json` for
scripting.

Other common things:

**"Bearer token required" when starting Claude Code**
Your CLI sent a request without a token. Run `agentops login --server <url>`.

**"Token may be invalid or revoked"**
Your token was revoked in the dashboard, or you logged in to a different
dashboard. `agentops logout && agentops login --server <url>`.

**Dashboard binds 127.0.0.1 — devs can't reach it**
That's the secure default. Edit `docker-compose.yml`'s `ports:` to expose,
ideally behind a reverse proxy that adds TLS. Be aware: the API is
authenticated per-request via Bearer/cookie, not at the network layer.

**Hooks aren't firing in Claude Code**
Check `.claude/settings.json` in your project (or `~/.claude/settings.json`
for `--global`). The hook commands should start with
`AGENTOPS_SERVER_URL=...` if you're in SDK mode, or `agentops hook` directly
in local mode. Re-run `agentops setup` if anything looks off.

**My runs aren't showing up in the dashboard**
Check `agentops whoami` — that's the user runs will be tagged with. Then
visit the dashboard signed in as that user.

**A request failed and I need help debugging it**
Error responses from the dashboard include a `requestId`. Quote it to your
operator; they grep the dashboard logs (`docker compose logs dashboard | grep <id>`)
and one line returns with method, path, status, and stack. Increase
`LOG_LEVEL=debug` in the dashboard's `.env` for more verbose tracing.

**Hook failed three sessions ago — where's the evidence?**
`~/.agentops/logs/hook.log` (5 MB rolling, 3 generations). Structured JSON
per line. `agentops doctor` surfaces the most recent failures.

---

## License

MIT
