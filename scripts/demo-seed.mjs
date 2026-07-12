#!/usr/bin/env node
// Wipes the local AgentOps DB's runs / events / policy_results and
// regenerates a team-shaped demo distribution: 6 users with realistic
// monthly usage, one user in the 80% budget warning band, last 30
// days of activity. Keeps users / policies / budgets / webhooks
// (other than the budget upserts below) untouched.
//
// DESTRUCTIVE — requires --yes. Usage:
//   npm run build                          # ensure dist/ is current
//   node scripts/demo-seed.mjs --yes       # against ~/.agentops/agentops.db
//   AGENTOPS_DB_PATH=/path/to.db node scripts/demo-seed.mjs --yes

import {
  getDb,
  listUsers,
  insertRun,
  upsertBudget,
} from "../packages/db/dist/index.js";
import {
  createRunId,
  createActionId,
  RunStatus,
} from "../packages/core/dist/index.js";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { homedir } from "node:os";

function resolveDbPath() {
  const fromEnv = process.env["AGENTOPS_DB_PATH"]?.trim();
  if (fromEnv) return fromEnv;
  return resolve(homedir(), ".agentops", "agentops.db");
}

// Target distribution. Sarah lands in the 80–99% warning band against
// a $300 cap — useful for showing the budget enforcement UX in action.
const PROFILES = [
  { email: "sarah@example.com",  runs: 18, total: 280, budget: 300 },
  { email: "marcus@example.com", runs: 22, total: 145, budget: 250 },
  { email: "ian@example.com",    runs: 25, total: 115, budget: 250 },
  { email: "priya@example.com",  runs: 15, total:  97, budget: 250 },
  { email: "diego@example.com",  runs: 12, total:  52, budget: 200 },
  { email: "teammate@acme.com",  runs:  5, total:  12, budget: 200 },
];

const REPOS = [
  { repo: "acme/backend",  weight: 4 },
  { repo: "acme/frontend", weight: 3 },
  { repo: "acme/api",      weight: 2 },
  { repo: "acme/mobile",   weight: 2 },
  { repo: "acme/infra",    weight: 1 },
];

const BRANCHES = [
  "main",
  "feature/auth-rewrite",
  "feature/checkout-v2",
  "bugfix/migration-rollback",
  "feature/dashboard-redesign",
  "feature/sso-integration",
  "feature/budget-alerts",
];

const GOALS = [
  { text: "Refactor session middleware for new token strategy",   type: "refactor" },
  { text: "Fix race condition in webhook retry loop",             type: "bugfix" },
  { text: "Add per-user budget alerts on dashboard home",         type: "feature" },
  { text: "Migrate user_orders to partitioned schema",            type: "migration" },
  { text: "Investigate flaky checkout E2E suite",                 type: "investigation" },
  { text: "Add bulk-action support to runs list",                 type: "feature" },
  { text: "Tighten policy_result query plan (slow on >50k rows)", type: "perf" },
  { text: "Update README with self-host docker instructions",     type: "docs" },
  { text: "Strip dead code from coordination module",             type: "cleanup" },
  { text: "Wire up Stop-hook budget warning",                     type: "feature" },
  { text: "Add audit log entry for policy toggle",                type: "feature" },
  { text: "Fix transcript path validation on Windows",            type: "bugfix" },
  { text: "Add retry-after honor to outbound webhook dispatcher", type: "feature" },
  { text: "Reduce flake in hook-integration tests",               type: "test" },
];

const TOOL_NAMES = ["Bash", "Edit", "Read", "Write", "Grep"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickWeighted(weighted) {
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.repo;
  }
  return weighted[0].repo;
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function uid() { return Math.random().toString(36).slice(2, 10); }

function daysAgo(days, jitterHours = 12) {
  const t = Date.now() - days * 86400000 - randInt(0, jitterHours * 3600000);
  return new Date(t);
}

function generateRun(profile, user, idx) {
  // 70% of runs in the last 14 days, 30% spread across days 14–30.
  // Makes "recent activity" feel right while still showing history.
  const day = Math.random() < 0.7 ? randInt(0, 14) : randInt(14, 30);
  const created = daysAgo(day);
  const updated = new Date(created.getTime() + randInt(5, 90) * 60_000);

  // Per-run cost varies around the profile average, with ~10% outliers.
  const avgCost = profile.total / profile.runs;
  const cost = Math.random() < 0.9
    ? Math.max(0.10, randFloat(avgCost * 0.3, avgCost * 1.8))
    : randFloat(avgCost * 2, avgCost * 4);

  // Status mix: 85% completed, 10% blocked (good for showing the
  // enforcement story), 5% failed.
  const r = randInt(0, 99);
  const status = r < 85 ? RunStatus.Completed : r < 95 ? RunStatus.Blocked : RunStatus.Failed;

  const goal = pick(GOALS);
  const actionCount = randInt(2, 12);

  // Rough Opus 4.7 base-input rate: ~$0.000015/token. Reverse-engineer
  // a token count from cost so the dashboard tokens column looks coherent.
  const tokens = Math.round(cost / 0.000015);

  const actions = Array.from({ length: actionCount }, (_, i) => ({
    id: createActionId(`action_${uid()}_${i}`),
    toolCalls: [{
      name: pick(TOOL_NAMES),
      input: {},
      output: "",
      timestamp: created.toISOString(),
    }],
    fileEdits: [],
    commands: [],
    timestamp: created.toISOString(),
  }));

  return {
    id: createRunId(`run_demo_${uid()}_${idx}`),
    status,
    goal: {
      humanReadable: goal.text,
      structured: { type: goal.type, description: goal.text, parameters: {} },
    },
    agents: [],
    environment: {
      repo: pickWeighted(REPOS),
      branch: pick(BRANCHES),
      permissions: ["read", "write", "execute"],
      sandbox: { enabled: true, isolationLevel: "container" },
    },
    actions,
    artifacts: [],
    metrics: {
      tokenUsage: {
        input: Math.round(tokens * 0.6),
        output: Math.round(tokens * 0.4),
        total: tokens,
      },
      wallTimeMs: randInt(60_000, 1_800_000),
      costUsd: Number(cost.toFixed(2)),
      flakeRate: 0,
    },
    evaluations: [],
    decisions: [],
    userId: user.id,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
  };
}

function main() {
  // Destructive: wipes all runs/events/policy_results/run_metrics before
  // regenerating the demo distribution. Require an explicit opt-in so a
  // stray invocation can't erase real captured history.
  if (!process.argv.includes("--yes")) {
    console.error(
      "demo-seed WIPES all runs, events, policy results, and run metrics in the target DB\n" +
        `(${resolveDbPath()}) and replaces them with fabricated demo data.\n\n` +
        "Re-run with --yes to confirm:\n" +
        "  node scripts/demo-seed.mjs --yes",
    );
    process.exit(1);
  }

  const db = getDb();
  const allUsers = listUsers(db);
  const byEmail = new Map(allUsers.map((u) => [u.email, u]));

  const missing = PROFILES.filter((p) => !byEmail.has(p.email));
  if (missing.length > 0) {
    console.error(`Missing users for: ${missing.map((m) => m.email).join(", ")}`);
    console.error("Run `agentops init --seed` first to create the seed users.");
    process.exit(1);
  }

  // Bypass drizzle + foreign-keys for the wipe. drizzle's row-by-row
  // DELETE chokes on FK constraints (run_metrics → runs, policy_results
  // → runs) even when we delete children first. A raw exec with FK
  // temporarily off is reliable and unambiguous.
  console.log("Wiping runs / events / policy_results / run_metrics …");
  const raw = new Database(resolveDbPath());
  try {
    raw.pragma("foreign_keys = OFF");
    raw.exec(`
      DELETE FROM events;
      DELETE FROM policy_results;
      DELETE FROM run_metrics;
      DELETE FROM runs;
    `);
    raw.pragma("foreign_keys = ON");
  } finally {
    raw.close();
  }

  let runCount = 0;
  let totalCost = 0;
  console.log("Generating distribution:");
  for (const profile of PROFILES) {
    const user = byEmail.get(profile.email);

    upsertBudget(db, {
      userId: user.id,
      amountUsd: profile.budget,
      period: "month",
      warnAtPct: 80,
    });

    // Generate all runs first, then scale per-run costs proportionally
    // so the user's total lands exactly on profile.total. Pinning only
    // the last run leaves wide variance — Sarah might be at 93% one
    // run and 107% the next, blowing the warning-band demo. Scaling
    // keeps relative variance between runs but makes totals deterministic.
    const userRuns = Array.from({ length: profile.runs }, (_, i) =>
      generateRun(profile, user, i),
    );
    const rawTotal = userRuns.reduce((s, r) => s + r.metrics.costUsd, 0);
    const scale = profile.total / rawTotal;
    let userCost = 0;
    for (const run of userRuns) {
      run.metrics.costUsd = Number((run.metrics.costUsd * scale).toFixed(2));
      userCost += run.metrics.costUsd;
      insertRun(db, run);
      runCount++;
    }
    totalCost += userCost;
    const pct = ((userCost / profile.budget) * 100).toFixed(0);
    console.log(
      `  ${profile.email.padEnd(24)} ${String(profile.runs).padStart(2)} runs   ` +
      `$${userCost.toFixed(2).padStart(7)} / $${profile.budget}   (${pct}%)`,
    );
  }

  console.log("");
  console.log(`Team total: ${runCount} runs across last 30 days, $${totalCost.toFixed(2)} spend.`);
  console.log("Open the dashboard to view.");
}

main();
