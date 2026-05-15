# Changelog

All notable changes to AgentOps are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`agentops --version` reports the package version plus the git short SHA of the
build and the build date — paste that into any support conversation as the
first thing.

## [Unreleased]

This section accumulates work going into the first tagged customer release.
Phase tags (A, B, C) match the customer-trial roadmap and the commit prefix
convention used in the git log.

### Added

#### Phase A — trial-blocking foundations

- **A1** HTTPS reference deployment via Caddy + Let's Encrypt. A customer can
  self-host the dashboard behind TLS without writing a config.
- **A2** Curated starter policy set (`agentops init --seed-policies`,
  plus a "Load starter policies" button in the dashboard). Seven policies
  cover destructive shell/git ops, secret detection, cost ceiling, network
  fetch tools, and a file-edit cap.
- **A3** Outbound webhooks signed with HMAC-SHA256. Per-event delivery with
  retries on transient failures; verified delivery history per webhook.
- **A4** Hook fail-closed mode. `AGENTOPS_FAIL_CLOSED=1` flips the default
  fail-open behavior to block tool calls when the hook can't reach the
  dashboard. Block message embeds the recovery instruction so an operator
  can self-unstick. Default mode also writes a loud "⚠ ENFORCEMENT OFFLINE"
  stderr line when SDK auth fails silently.
- **A5** SDK pre-tool block now emits `policy.violated` events and fires
  webhooks. Previously these were only emitted on `run.complete`, so live
  pre-tool blocks were silently absent from the audit trail in SDK mode.

#### Phase B — UI customer-readiness

- **B2 (a–e)** Cost surfacing across the dashboard. Cost + tokens on the Run
  detail page (Cost card, Token Usage panel), Run list cards (Cost chip in
  each card's metrics row), home page header (Total Spend stat), Session
  detail (Resource Usage card aggregated from completed runs), Analytics
  page (Total Spend, Cost Per Day chart, cost-by-repo on the Top Repos
  panel), Usage page (AgentOps-local totals always shown; Anthropic Admin
  API becomes additive when configured).
- **B3 (a–d)** Multi-user attribution everywhere. User chips on Runs and
  Sessions lists, user badge on detail page headers, "Top Users by Run
  Count" on Analytics with cost rollups, a user filter dropdown on the
  Events page that resolves user → owned run/session IDs server-side.
- **B4** `policy_results` rows are persisted on every code path. Run
  completion writes one rollup row per active policy; pre-tool blocks
  write a row per fire with `details.source = "pre-tool"`. The Policy
  detail page now shows real evaluation history instead of "No data".
- **B5** Stale run/session detection + reaping. `isStaleRun` and
  `isStaleSession` helpers identify records still in `running` / `active`
  status without a heartbeat for 30+ minutes. New `agentops cleanup`
  CLI lists stale entities as a dry-run preview and reaps them with
  `--apply` (marks runs failed, sessions terminated, emits audit events).
  StaleBadge component renders next to status pills throughout the UI.
- **B6** `getCurrentRepo()` fallback chain. Tries `origin`, `upstream`,
  `github` remote names, then falls back to the basename of
  `git rev-parse --show-toplevel`. Repos without any remote (forks,
  mirrored clones, local-only projects) now show their directory name
  instead of "unknown".
- **B7** User + API token management in Settings. Admins can list
  team members, invite new users (POST `/api/users` returns a one-time
  temp password), view all team tokens (with owner / created / last-used /
  expires), and revoke any token. Members see only their own tokens.
- **B8a** Page titles, ID copy-to-clipboard buttons on Run / Session
  detail headers, events time-range filter applies server-side (the
  count display no longer lies).
- **B8b** Human-readable policy config column on the Policies list
  ("Max $25 per session", "Block patterns: rm -rf, sudo rm, ...") in
  place of the raw JSON dump. `agentops admin regenerate-summaries`
  CLI to backfill old `session_summary` JSON whose headlines still
  contain pre-B2 strings. EventCard renders a direct link to the
  violated policy on `policy.violated` events. `agentops doctor`
  reports hook mode correctly when SDK is driven by `credentials.json`
  (the standard `agentops setup` install) rather than by an env-var
  prefix in the hook command.

### Fixed

- **B1** `/sessions/[id]` no longer crashes on the dashboard. Two bugs in
  the `CompletedRunsTable`: unwrapping `{run, summary}` as `run` (every
  field access returned `undefined`) and missing optional chains on
  `goal?.humanReadable` / `metrics?.wallTimeMs`.
- `agentops init --seed-policies` honors the flag when the DB already
  exists. Previously the existing-DB short-circuit silently dropped the
  flag.
- `agentops doctor` correctly handles 200-with-no-user responses from
  `/api/auth/me` (the Anthropic dashboard's intentional unauth shape).
  Previously reported "✗ Dashboard returned HTTP 200" which read as if
  the dashboard itself was broken.

### Security

- **A4** fail-closed mode (`AGENTOPS_FAIL_CLOSED=1`) — see Added. Closes
  the silent-degradation hole where enforcement was effectively off
  whenever the hook couldn't reach the dashboard.

### Test coverage

A pre-release coverage sweep added 75 tests across six areas: web routes
for B7 (users + tokens), DB helpers for B4 + B7, CLI behavior tests for
`cleanup` / `admin` / `doctor`, policy-config summary helper, webhook
dispatcher assertion, /api/admin proxy routes, and a full hook-lifecycle
integration test. Total ≈ 874 tests passing across the workspace.

## Earlier history

The project went through several iterations before Phase A. The summary:

- Sprints 1–12 (commits up to `cbfd865`): scaffold the monorepo, build the
  core domain types (Run, Job, Session, Policy, Event), wire the dashboard,
  add the SDK, and bring in Claude Code adapter + scoring + summaries.
- Hardening phases 1–5 (commits up to `ef36bd9`): security defaults, real
  Anthropic API URLs, dropping fictional hook events, the device-flow auth,
  hooks-call-SDK migration, Docker compose self-host, Litestream backup,
  structured logging, and `agentops doctor`.
- Test bootstrap C1–C5 (commits `556ea15`–`436b13a`): the initial unit and
  route test foundations the Phase A/B work built on.

See `git log` for the complete commit-level history.
