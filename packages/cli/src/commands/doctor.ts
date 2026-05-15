import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  readCredentials,
  readConfig,
  credentialsPath,
  configPath,
  resolveServerUrl,
} from "../credentials.js";
import { logFilePath } from "../log.js";

// agentops doctor — self-service diagnostic for the customer trial.
//
// Runs a handful of checks (credentials, dashboard reachability, hook
// installation, recent activity, queued events) and prints a friendly
// checklist with actionable hints for any failures. Exits non-zero if
// any check ✗ so it can be wired into health-check scripts.

const supportsColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const paint = supportsColor
  ? {
      green: (s: string) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
      red: (s: string) => `\x1b[31m${s}\x1b[0m`,
      dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
      bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    }
  : {
      green: (s: string) => s,
      yellow: (s: string) => s,
      red: (s: string) => s,
      dim: (s: string) => s,
      bold: (s: string) => s,
    };

const MARK_OK = paint.green("✓");
const MARK_WARN = paint.yellow("⚠");
const MARK_FAIL = paint.red("✗");

type Level = "ok" | "warn" | "fail";

interface Check {
  readonly section: string;
  readonly level: Level;
  readonly msg: string;
  readonly hint?: string;
  readonly detail?: Record<string, unknown>;
}

// ─── Individual check helpers ──────────────────────────────────────────────

async function reachDashboard(
  serverUrl: string,
  token: string | undefined,
): Promise<{
  ok: boolean;
  ms: number;
  status?: number;
  user?: { email: string; role: string };
  error?: string;
}> {
  const start = Date.now();
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/auth/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const ms = Date.now() - start;
    if (!res.ok) return { ok: false, ms, status: res.status };
    const data = (await res.json().catch(() => null)) as {
      user?: { email: string; role: string };
    } | null;
    if (!data?.user) return { ok: false, ms, status: res.status };
    return { ok: true, ms, status: res.status, user: data.user };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface HookInstallStatus {
  readonly path: string;
  readonly installed: boolean;
  readonly mode: "sdk" | "local" | null;
  readonly serverUrl?: string;
}

function readHookInstall(settingsPath: string): HookInstallStatus {
  if (!existsSync(settingsPath)) {
    return { path: settingsPath, installed: false, mode: null };
  }
  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as {
      hooks?: Record<
        string,
        Array<{ hooks: Array<{ command?: string }> }>
      >;
    };
    const matchers = Object.values(settings.hooks ?? {});
    let found: string | undefined;
    for (const ms of matchers) {
      for (const m of ms) {
        for (const h of m.hooks ?? []) {
          if (h.command && h.command.includes("agentops hook")) {
            found = h.command;
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) {
      return { path: settingsPath, installed: false, mode: null };
    }
    // Mode resolution mirrors hook-ops.resolveOpsConfig():
    //   1. AGENTOPS_SERVER_URL= prefix in the settings command → SDK
    //   2. Otherwise consult credentials.json — if it has both a server
    //      URL and a token, the hook runtime will pick SDK mode
    //   3. Otherwise local
    // Previously this only checked the env-var prefix, so a standard
    // `agentops setup` install (no prefix) reported "local-SQLite" even
    // when credentials.json was driving the hook into SDK mode.
    const envPrefix = /AGENTOPS_SERVER_URL=(\S+)\s+agentops hook/.exec(found);
    if (envPrefix && envPrefix[1]) {
      return {
        path: settingsPath,
        installed: true,
        mode: "sdk",
        serverUrl: envPrefix[1],
      };
    }
    const creds = readCredentials();
    if (creds?.server && creds.token) {
      return {
        path: settingsPath,
        installed: true,
        mode: "sdk",
        serverUrl: creds.server,
      };
    }
    return { path: settingsPath, installed: true, mode: "local" };
  } catch {
    return { path: settingsPath, installed: false, mode: null };
  }
}

interface RecentEntry {
  readonly ts?: string;
  readonly level?: string;
  readonly msg?: string;
  readonly [k: string]: unknown;
}

function readRecentLog(limit = 200): RecentEntry[] {
  const path = logFilePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const slice = lines.slice(-limit);
    const out: RecentEntry[] = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as RecentEntry);
      } catch {
        // skip
      }
    }
    return out.reverse(); // newest first
  } catch {
    return [];
  }
}

interface DirStats {
  readonly path: string;
  readonly count: number;
  readonly oldestMs?: number;
  readonly oldestName?: string;
}

function inspectDir(subdir: string): DirStats {
  const path = join(homedir(), ".agentops", subdir);
  if (!existsSync(path)) return { path, count: 0 };
  try {
    const entries = readdirSync(path).filter((n) => !n.startsWith("."));
    let oldestMs: number | undefined;
    let oldestName: string | undefined;
    for (const name of entries) {
      const full = join(path, name);
      try {
        const s = statSync(full);
        const age = Date.now() - s.mtimeMs;
        if (oldestMs === undefined || age > oldestMs) {
          oldestMs = age;
          oldestName = name;
        }
      } catch {
        /* ignore */
      }
    }
    return { path, count: entries.length, oldestMs, oldestName };
  } catch {
    return { path, count: 0 };
  }
}

function humanDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// ─── The main run ──────────────────────────────────────────────────────────

interface DoctorResult {
  readonly checks: ReadonlyArray<Check>;
  readonly ok: boolean;
}

async function runDoctor(): Promise<DoctorResult> {
  const checks: Check[] = [];

  // ── Authentication ──────────────────────────────────────────────────
  const creds = readCredentials();
  const config = readConfig();
  const serverUrl = resolveServerUrl();

  if (!creds) {
    if (config.server) {
      checks.push({
        section: "auth",
        level: "warn",
        msg: `Config knows about ${config.server} but you're not logged in`,
        hint: `Run: agentops login --server ${config.server}`,
      });
    } else {
      checks.push({
        section: "auth",
        level: "warn",
        msg: "Not logged in (no ~/.agentops/credentials.json)",
        hint: "Run: agentops login --server <dashboard-url> (or skip — local-only mode also works)",
      });
    }
  } else {
    checks.push({
      section: "auth",
      level: "ok",
      msg: `Credentials at ${credentialsPath()} (user ${creds.user.email})`,
    });
    const r = await reachDashboard(creds.server, creds.token);
    if (r.ok && r.user) {
      checks.push({
        section: "auth",
        level: "ok",
        msg: `Dashboard ${creds.server} reachable (${r.ms}ms), token valid for ${r.user.email} (${r.user.role})`,
      });
    } else if (
      r.status === 401 ||
      r.status === 403 ||
      // /api/auth/me returns 200 with {user: null} when the token is
      // missing/invalid (it doesn't 401). Treat that as auth failure
      // rather than a generic "Dashboard returned HTTP 200" error,
      // which is misleading since 200 is a successful response.
      (r.status === 200 && !r.user)
    ) {
      checks.push({
        section: "auth",
        level: "fail",
        msg: `Token rejected by ${creds.server} (HTTP ${r.status})`,
        hint: "Run: agentops logout && agentops login --server " + creds.server,
      });
    } else if (r.error) {
      checks.push({
        section: "auth",
        level: "fail",
        msg: `Cannot reach ${creds.server}: ${r.error}`,
        hint: "Check the dashboard is running and the URL is correct",
      });
    } else {
      checks.push({
        section: "auth",
        level: "fail",
        msg: `Dashboard returned HTTP ${r.status}`,
      });
    }
  }

  // ── Hooks ───────────────────────────────────────────────────────────
  const projectHooksPath = resolve(process.cwd(), ".claude", "settings.json");
  const globalHooksPath = resolve(homedir(), ".claude", "settings.json");

  const projectHooks = readHookInstall(projectHooksPath);
  const globalHooks = readHookInstall(globalHooksPath);

  if (!projectHooks.installed && !globalHooks.installed) {
    checks.push({
      section: "hooks",
      level: "warn",
      msg: "No AgentOps hooks installed (project or global)",
      hint: "Run: agentops setup (project) or agentops setup --global",
    });
  } else {
    if (projectHooks.installed) {
      const modeNote = projectHooks.mode === "sdk"
        ? `SDK → ${projectHooks.serverUrl}`
        : "local-SQLite";
      checks.push({
        section: "hooks",
        level: "ok",
        msg: `Project hooks at ${projectHooks.path} (${modeNote})`,
      });
    }
    if (globalHooks.installed) {
      const modeNote = globalHooks.mode === "sdk"
        ? `SDK → ${globalHooks.serverUrl}`
        : "local-SQLite";
      checks.push({
        section: "hooks",
        level: "ok",
        msg: `Global hooks at ${globalHooks.path} (${modeNote})`,
      });
    }
    // Sanity: hook server URL should match the user's credentials.
    const activeHookServer =
      projectHooks.serverUrl ?? globalHooks.serverUrl;
    if (creds && activeHookServer && activeHookServer !== creds.server) {
      checks.push({
        section: "hooks",
        level: "warn",
        msg: `Hook command targets ${activeHookServer} but credentials are for ${creds.server}`,
        hint: "Re-run agentops setup to align them, or agentops login to change dashboard",
      });
    }
  }

  // ── Recent activity ─────────────────────────────────────────────────
  const recent = readRecentLog(500);
  if (recent.length === 0) {
    checks.push({
      section: "activity",
      level: "warn",
      msg: `No entries in ${logFilePath()}`,
      hint: "Start a Claude Code session to generate activity",
    });
  } else {
    const lastStart = recent.find((e) => e.msg === "session_started");
    const lastEnd = recent.find((e) => e.msg === "session_ended");
    const lastFailure = recent.find((e) => e.msg === "sdk_call_failed");
    const lastBlock = recent.find((e) => e.msg === "policy_blocked");

    if (lastStart && typeof lastStart.ts === "string") {
      const age = Date.now() - new Date(lastStart.ts).getTime();
      checks.push({
        section: "activity",
        level: "ok",
        msg: `Last session-start: ${humanDuration(age)} (session ${String(lastStart.sessionId ?? "?").slice(0, 12)})`,
      });
    }
    if (lastEnd && typeof lastEnd.ts === "string") {
      const age = Date.now() - new Date(lastEnd.ts).getTime();
      const cost = typeof lastEnd.costUsd === "number" ? `$${lastEnd.costUsd.toFixed(2)}` : "?";
      checks.push({
        section: "activity",
        level: "ok",
        msg: `Last session-end: ${humanDuration(age)} (cost ${cost})`,
      });
    }
    if (lastBlock && typeof lastBlock.ts === "string") {
      const age = Date.now() - new Date(lastBlock.ts).getTime();
      checks.push({
        section: "activity",
        level: "ok",
        msg: `Last policy block: ${humanDuration(age)} — ${String(lastBlock.reason ?? "?").slice(0, 80)}`,
      });
    }
    if (lastFailure && typeof lastFailure.ts === "string") {
      const age = Date.now() - new Date(lastFailure.ts).getTime();
      checks.push({
        section: "activity",
        level: "warn",
        msg: `Last SDK failure: ${humanDuration(age)} (${String(lastFailure.op ?? "?")}, ${String(lastFailure.err ?? "?").slice(0, 80)})`,
        hint:
          age < 5 * 60 * 1000
            ? "Recent — check dashboard reachability and token validity"
            : undefined,
      });
    }
  }

  // ── Disk state (outbox + state files) ───────────────────────────────
  const outbox = inspectDir("outbox");
  const state = inspectDir("state");

  if (outbox.count > 0) {
    checks.push({
      section: "activity",
      level: "warn",
      msg: `Outbox has ${outbox.count} pending session file(s) (${outbox.path})`,
      hint: outbox.oldestMs && outbox.oldestMs > 24 * 60 * 60 * 1000
        ? `Oldest is ${humanDuration(outbox.oldestMs)} — likely orphaned; consider rm`
        : "Will retry on the next hook fire for those sessions",
    });
  } else {
    checks.push({
      section: "activity",
      level: "ok",
      msg: "Outbox empty",
    });
  }

  if (state.count > 0) {
    // State files are per active Claude Code session. A few are normal
    // (one per concurrent session). Many old files suggest orphans.
    const stale = state.oldestMs && state.oldestMs > 6 * 60 * 60 * 1000;
    checks.push({
      section: "activity",
      level: stale ? "warn" : "ok",
      msg: `${state.count} state file(s) under ${state.path}${stale ? ` (oldest ${humanDuration(state.oldestMs!)})` : ""}`,
      hint: stale
        ? "Hooks normally clean up; old files may indicate sessions that didn't end cleanly"
        : undefined,
    });
  }

  const ok = !checks.some((c) => c.level === "fail");
  return { checks, ok };
}

// ─── Printing ──────────────────────────────────────────────────────────────

const SECTION_TITLES: Record<string, string> = {
  auth: "Authentication",
  hooks: "Hooks",
  activity: "Recent activity",
};

function printResult(result: DoctorResult): void {
  console.log(paint.bold("AgentOps Doctor"));
  console.log("");

  const sections = ["auth", "hooks", "activity"];
  for (const section of sections) {
    const items = result.checks.filter((c) => c.section === section);
    if (items.length === 0) continue;
    console.log(paint.bold(SECTION_TITLES[section] ?? section));
    for (const item of items) {
      const mark =
        item.level === "ok" ? MARK_OK : item.level === "warn" ? MARK_WARN : MARK_FAIL;
      console.log(`  ${mark} ${item.msg}`);
      if (item.hint) console.log(paint.dim(`    ${item.hint}`));
    }
    console.log("");
  }

  if (result.ok) {
    console.log(paint.green("All checks passed."));
  } else {
    console.log(
      paint.red("Some checks failed.") +
        " Address the ✗ items above; rerun `agentops doctor` to confirm.",
    );
  }
}

// ─── Command registration ──────────────────────────────────────────────────

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run a checklist of diagnostics on the local AgentOps setup")
    .action(async () => {
      const json = program.opts()["json"] as boolean | undefined;
      const result = await runDoctor();
      if (json) {
        console.log(
          JSON.stringify(
            {
              ok: result.ok,
              checks: result.checks,
            },
            null,
            2,
          ),
        );
      } else {
        printResult(result);
      }
      if (!result.ok) process.exit(1);
    });
}
