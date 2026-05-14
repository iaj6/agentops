import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Two files in ~/.agentops/:
//   config.json       — shared, non-secret. Holds the dashboard server URL.
//   credentials.json  — secret, mode 0600. Holds the bearer token + user.

export interface ConfigFile {
  readonly server?: string;
}

export interface CredentialsFile {
  readonly server: string;
  readonly token: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name?: string | null;
    readonly role?: string;
  };
}

export function configPath(): string {
  return join(homedir(), ".agentops", "config.json");
}

export function credentialsPath(): string {
  return join(homedir(), ".agentops", "credentials.json");
}

function ensureDir(filePath: string, mode: number = 0o755): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode });
  }
}

export function readConfig(): ConfigFile {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as ConfigFile;
  } catch {
    return {};
  }
}

export function writeConfig(config: ConfigFile): void {
  const p = configPath();
  ensureDir(p);
  writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function readCredentials(): CredentialsFile | null {
  const p = credentialsPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as CredentialsFile;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: CredentialsFile): void {
  const p = credentialsPath();
  ensureDir(p, 0o700);
  writeFileSync(p, JSON.stringify(creds, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    chmodSync(p, 0o600);
  } catch {
    // Best-effort.
  }
}

export function deleteCredentials(): boolean {
  const p = credentialsPath();
  if (!existsSync(p)) return false;
  try {
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the dashboard server URL using this precedence:
 *   1. AGENTOPS_SERVER_URL env var
 *   2. --server flag (passed in)
 *   3. ~/.agentops/credentials.json server (from a prior login)
 *   4. ~/.agentops/config.json server
 *   5. null (caller must error)
 */
export function resolveServerUrl(explicit?: string): string | null {
  const fromEnv = process.env["AGENTOPS_SERVER_URL"];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (explicit && explicit.trim().length > 0) return explicit.trim();
  const creds = readCredentials();
  if (creds?.server) return creds.server;
  const config = readConfig();
  if (config.server) return config.server;
  return null;
}
