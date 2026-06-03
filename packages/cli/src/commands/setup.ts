import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { readCredentials, readConfig } from "../credentials.js";

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface HooksConfig {
  [eventName: string]: HookMatcher[];
}

interface SettingsJson {
  hooks?: HooksConfig;
  [key: string]: unknown;
}

const AGENTOPS_HOOK_MARKER = "agentops hook";

/**
 * Resolve the dashboard server URL to bake into the hook command. Precedence:
 *   --server flag > AGENTOPS_SERVER_URL env > credentials.json > config.json
 * Returns null when nothing is configured (hooks will then run in
 * direct-SQLite mode).
 */
function resolveServerForSetup(serverFlag?: string): string | null {
  if (serverFlag && serverFlag.trim().length > 0) return serverFlag.trim();
  const fromEnv = process.env["AGENTOPS_SERVER_URL"]?.trim();
  if (fromEnv) return fromEnv;
  const creds = readCredentials();
  if (creds?.server) return creds.server;
  const config = readConfig();
  if (config.server) return config.server;
  return null;
}

// The server URL is interpolated into a shell command string written to
// Claude Code's settings.json. Validate it's a well-formed http(s) URL with no
// whitespace or shell metacharacters so it can't break out of / inject into
// that command (a valid URL never needs those characters).
function validateServerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--server must be a valid URL (got: ${url})`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`--server must be an http(s) URL (got: ${url})`);
  }
  if (/[\s'"`$;&|<>(){}\\]/.test(url)) {
    throw new Error(`--server URL contains unsafe characters (got: ${url})`);
  }
}

function buildHooksConfig(args: { dbPathFlag?: string; serverUrl?: string }): HooksConfig {
  if (args.serverUrl) validateServerUrl(args.serverUrl);
  const dbArg = args.dbPathFlag ? ` --db-path ${args.dbPathFlag}` : "";
  // When a dashboard is configured, prefix the hook command with the env
  // var so AgentOps stays in SDK mode even if the user's shell environment
  // changes. The token is still read from ~/.agentops/credentials.json at
  // hook time — we never bake a token into a settings file.
  const prefix = args.serverUrl
    ? `AGENTOPS_SERVER_URL=${args.serverUrl} `
    : "";
  const cmd = (sub: string) => `${prefix}agentops hook ${sub}${dbArg}`;
  return {
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: cmd("session-start") }] }],
    // UserPromptSubmit closes the chat-only enforcement gap: PreToolUse
    // only fires when Claude is about to call a tool, so analysis-only or
    // long-conversation turns would otherwise blow CostCeiling caps
    // without enforcement. This handler re-checks budget before each
    // user prompt is processed.
    UserPromptSubmit: [
      { matcher: "", hooks: [{ type: "command", command: cmd("user-prompt-submit") }] },
    ],
    PreToolUse: [
      {
        matcher: "Bash|Edit|Write|NotebookEdit",
        hooks: [{ type: "command", command: cmd("pre-tool-use") }],
      },
    ],
    PostToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("post-tool-use") }] }],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: cmd("stop") }] }],
    SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: cmd("session-end") }] }],
    // SubagentStart is intentionally omitted — it is not a real Claude Code
    // hook event. We track sub-agents via SubagentStop only.
    SubagentStop: [{ matcher: "", hooks: [{ type: "command", command: cmd("subagent-stop") }] }],
  };
}

function isAgentOpsHookEntry(entry: HookEntry): boolean {
  return entry.command.includes(AGENTOPS_HOOK_MARKER);
}

function isAgentOpsMatcher(matcher: HookMatcher): boolean {
  return matcher.hooks.some(isAgentOpsHookEntry);
}

function mergeHooks(existing: HooksConfig, incoming: HooksConfig): HooksConfig {
  const merged: HooksConfig = { ...existing };

  for (const [eventName, incomingMatchers] of Object.entries(incoming)) {
    const existingMatchers = merged[eventName] ?? [];

    // Remove any existing AgentOps matchers for this event
    const nonAgentOps = existingMatchers.filter((m) => !isAgentOpsMatcher(m));

    // Add the new AgentOps matchers
    merged[eventName] = [...nonAgentOps, ...incomingMatchers];
  }

  return merged;
}

function removeAgentOpsHooks(hooks: HooksConfig): HooksConfig {
  const cleaned: HooksConfig = {};

  for (const [eventName, matchers] of Object.entries(hooks)) {
    const filtered = matchers.filter((m) => !isAgentOpsMatcher(m));
    if (filtered.length > 0) {
      cleaned[eventName] = filtered;
    }
  }

  return cleaned;
}

function readSettings(filePath: string): SettingsJson {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as SettingsJson;
}

function writeSettings(filePath: string, settings: SettingsJson): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

export function getSettingsPath(global: boolean, cwd?: string): string {
  if (global) {
    return resolve(homedir(), ".claude", "settings.json");
  }
  return resolve(cwd ?? process.cwd(), ".claude", "settings.json");
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Configure Claude Code hooks to report to AgentOps")
    .option("--global", "Write to ~/.claude/settings.json instead of project-level")
    .option("--uninstall", "Remove AgentOps hooks from the config")
    .option("--dry-run", "Show what would be written without actually writing")
    .option(
      "--server <url>",
      "Dashboard URL to send hook events to (overrides credentials.json)",
    )
    .option(
      "--local",
      "Force direct-SQLite mode even if a dashboard is configured",
    )
    .action(
      (opts: { global?: boolean; uninstall?: boolean; dryRun?: boolean; server?: string; local?: boolean }) => {
        const dbPath = program.opts()["dbPath"] as string | undefined;
        const json = program.opts()["json"] as boolean | undefined;

        const settingsPath = getSettingsPath(!!opts.global);
        const settings = readSettings(settingsPath);

        if (opts.uninstall) {
          if (!settings.hooks) {
            if (json) {
              console.log(JSON.stringify({ status: "no-hooks", path: settingsPath }));
            } else {
              console.log(`No hooks found in ${settingsPath}`);
            }
            return;
          }

          const cleaned = removeAgentOpsHooks(settings.hooks);
          const updatedSettings: SettingsJson = { ...settings };
          if (Object.keys(cleaned).length > 0) {
            updatedSettings.hooks = cleaned;
          } else {
            delete updatedSettings.hooks;
          }

          if (opts.dryRun) {
            if (json) {
              console.log(JSON.stringify({ status: "dry-run", action: "uninstall", path: settingsPath, settings: updatedSettings }));
            } else {
              console.log(`Dry run — would write to ${settingsPath}:`);
              console.log(JSON.stringify(updatedSettings, null, 2));
            }
            return;
          }

          writeSettings(settingsPath, updatedSettings);

          if (json) {
            console.log(JSON.stringify({ status: "uninstalled", path: settingsPath }));
          } else {
            console.log(`AgentOps hooks removed from ${settingsPath}`);
          }
          return;
        }

        // Resolve server URL (skipped if --local was passed).
        const serverUrl = opts.local
          ? null
          : resolveServerForSetup(opts.server);

        // Install / update hooks
        const incoming = buildHooksConfig({
          ...(dbPath ? { dbPathFlag: dbPath } : {}),
          ...(serverUrl ? { serverUrl } : {}),
        });
        const mergedHooks = mergeHooks(settings.hooks ?? {}, incoming);
        const updatedSettings: SettingsJson = { ...settings, hooks: mergedHooks };

        if (opts.dryRun) {
          if (json) {
            console.log(JSON.stringify({
              status: "dry-run",
              action: "install",
              path: settingsPath,
              mode: serverUrl ? "sdk" : "local",
              serverUrl: serverUrl ?? null,
              settings: updatedSettings,
            }));
          } else {
            console.log(`Dry run — would write to ${settingsPath}:`);
            console.log(JSON.stringify(updatedSettings, null, 2));
          }
          return;
        }

        writeSettings(settingsPath, updatedSettings);

        if (json) {
          console.log(JSON.stringify({
            status: "configured",
            path: settingsPath,
            mode: serverUrl ? "sdk" : "local",
            serverUrl: serverUrl ?? null,
            hooks: Object.keys(incoming),
          }));
        } else {
          console.log(`AgentOps hooks configured in ${settingsPath}`);
          console.log();
          if (serverUrl) {
            console.log(`Mode:   SDK (events sent to ${serverUrl})`);
            const creds = readCredentials();
            if (!creds?.token) {
              console.log();
              console.log(`  ⚠  No credentials.json found at ~/.agentops/. Run:`);
              console.log(`       agentops login --server ${serverUrl}`);
              console.log(`     before starting Claude Code, otherwise hooks will fail open.`);
            } else if (creds.server !== serverUrl) {
              console.log();
              console.log(`  ⚠  Your stored credentials are for ${creds.server},`);
              console.log(`     but setup baked ${serverUrl} into the hook command.`);
              console.log(`     Re-run agentops login --server ${serverUrl} or remove --server.`);
            }
          } else {
            console.log(`Mode:   local (writing to ${dbPath ?? "~/.agentops/agentops.db"})`);
            console.log();
            console.log(`To send events to a team dashboard instead:`);
            console.log(`  agentops login --server <dashboard-url>`);
            console.log(`  agentops setup            # re-run after login`);
          }
          console.log();
          console.log(`Hooks installed:`);
          for (const eventName of Object.keys(incoming)) {
            console.log(`  - ${eventName}`);
          }
          console.log();
          console.log(`Start a Claude Code session and check the dashboard to verify.`);
        }
      },
    );
}
