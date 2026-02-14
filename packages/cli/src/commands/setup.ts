import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

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

function buildHooksConfig(dbPathFlag?: string): HooksConfig {
  const dbArg = dbPathFlag ? ` --db-path ${dbPathFlag}` : "";
  return {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `agentops hook session-start${dbArg}`,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash|Edit|Write|NotebookEdit",
        hooks: [
          {
            type: "command",
            command: `agentops hook pre-tool-use${dbArg}`,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: `agentops hook post-tool-use${dbArg}`,
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `agentops hook stop${dbArg}`,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `agentops hook session-end${dbArg}`,
          },
        ],
      },
    ],
    SubagentStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `agentops hook subagent-start${dbArg}`,
          },
        ],
      },
    ],
    SubagentStop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `agentops hook subagent-stop${dbArg}`,
          },
        ],
      },
    ],
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
    .action(
      (opts: { global?: boolean; uninstall?: boolean; dryRun?: boolean }) => {
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

        // Install / update hooks
        const incoming = buildHooksConfig(dbPath);
        const mergedHooks = mergeHooks(settings.hooks ?? {}, incoming);
        const updatedSettings: SettingsJson = { ...settings, hooks: mergedHooks };

        if (opts.dryRun) {
          if (json) {
            console.log(JSON.stringify({ status: "dry-run", action: "install", path: settingsPath, settings: updatedSettings }));
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
            hooks: Object.keys(incoming),
          }));
        } else {
          console.log(`AgentOps hooks configured in ${settingsPath}`);
          console.log();
          console.log(`Hooks installed:`);
          for (const eventName of Object.keys(incoming)) {
            console.log(`  - ${eventName}`);
          }
          console.log();
          console.log(`Run Claude Code and check the AgentOps dashboard to verify.`);
        }
      },
    );
}
