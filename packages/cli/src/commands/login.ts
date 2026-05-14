import { Command } from "commander";
import {
  resolveServerUrl,
  writeConfig,
  writeCredentials,
  readCredentials,
  deleteCredentials,
  readConfig,
  configPath,
  credentialsPath,
} from "../credentials.js";

interface DeviceInit {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
}

interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  } | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function getJson<T>(url: string, token?: string): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export function registerLoginCommands(program: Command): void {
  program
    .command("login")
    .description("Sign in to an AgentOps dashboard via browser approval")
    .option("--server <url>", "Dashboard URL (e.g. https://agentops.acme.internal)")
    .action(async (opts: { server?: string }) => {
      const json = program.opts()["json"] as boolean | undefined;

      const server = resolveServerUrl(opts.server);
      if (!server) {
        const msg =
          "No server URL configured. Pass --server <url> or set AGENTOPS_SERVER_URL.";
        if (json) console.log(JSON.stringify({ status: "error", error: msg }));
        else console.error(msg);
        process.exit(1);
      }

      const base = server.replace(/\/$/, "");

      // Step 1: initiate the device authorization grant.
      let init: { status: number; data: DeviceInit };
      try {
        init = await postJson<DeviceInit>(`${base}/api/auth/device`, {});
      } catch (err) {
        const msg = `Could not reach dashboard at ${base}: ${err instanceof Error ? err.message : "network error"}`;
        if (json) console.log(JSON.stringify({ status: "error", error: msg }));
        else console.error(msg);
        process.exit(1);
      }
      if (init.status !== 200 || !init.data.device_code) {
        const msg = `Dashboard returned HTTP ${init.status} from /api/auth/device`;
        if (json) console.log(JSON.stringify({ status: "error", error: msg }));
        else console.error(msg);
        process.exit(1);
      }

      const {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        interval,
      } = init.data;

      if (json) {
        // In JSON mode, surface the data and exit; callers can drive the
        // poll themselves. (Useful for scripting.)
        console.log(
          JSON.stringify({
            status: "pending",
            user_code,
            verification_uri,
            verification_uri_complete,
            interval,
          }),
        );
      } else {
        console.log(``);
        console.log(`Open this URL in your browser to approve:`);
        console.log(``);
        console.log(`  ${verification_uri_complete}`);
        console.log(``);
        console.log(`Or visit ${verification_uri} and enter:  ${user_code}`);
        console.log(``);
        console.log(`Waiting for approval...`);
      }

      // Step 2: poll for the access token.
      const pollIntervalMs = Math.max(1000, interval * 1000);
      let pollCount = 0;
      const maxPolls = Math.ceil((init.data.expires_in * 1000) / pollIntervalMs);

      while (pollCount < maxPolls) {
        await sleep(pollIntervalMs);
        pollCount++;
        let poll: { status: number; data: TokenResponse };
        try {
          poll = await postJson<TokenResponse>(`${base}/api/auth/device/token`, {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code,
          });
        } catch (err) {
          // Network blip. Retry next interval.
          continue;
        }

        if (poll.status === 200 && poll.data.access_token) {
          const token = poll.data.access_token;
          // Step 3: fetch the user record so we can store + display it.
          const me = await getJson<MeResponse>(`${base}/api/auth/me`, token);
          const user = me.data.user;
          if (!user) {
            const msg = "Approval succeeded but /api/auth/me returned no user.";
            if (json) console.log(JSON.stringify({ status: "error", error: msg }));
            else console.error(msg);
            process.exit(1);
          }

          // Persist the server in config (shareable) and the token in
          // credentials (secret, 0600).
          writeConfig({ ...readConfig(), server: base });
          writeCredentials({
            server: base,
            token,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
            },
          });

          if (json) {
            console.log(
              JSON.stringify({
                status: "logged_in",
                server: base,
                user: { email: user.email, role: user.role },
                credentialsPath: credentialsPath(),
              }),
            );
          } else {
            console.log(``);
            console.log(`Signed in as ${user.email} (${user.role}).`);
            console.log(`Credentials saved to ${credentialsPath()}.`);
          }
          return;
        }

        // OAuth error codes from /api/auth/device/token.
        const error = poll.data.error;
        if (error === "authorization_pending") {
          // Keep polling silently. The expected case.
          continue;
        }
        if (error === "slow_down") {
          // Server asked us to back off. Add a fixed 5s to the cadence as
          // recommended by RFC 8628.
          await sleep(5000);
          continue;
        }
        if (error === "expired_token") {
          const msg = `The device code expired before approval (after ~${Math.round((init.data.expires_in / 60))} minutes). Run agentops login again.`;
          if (json) console.log(JSON.stringify({ status: "expired" }));
          else console.error(msg);
          process.exit(1);
        }
        if (error === "access_denied") {
          const msg = "Approval was denied. Run agentops login again if this was a mistake.";
          if (json) console.log(JSON.stringify({ status: "denied" }));
          else console.error(msg);
          process.exit(1);
        }
        // Any other error is fatal.
        const msg = `Login failed: ${error ?? `HTTP ${poll.status}`}`;
        if (json) console.log(JSON.stringify({ status: "error", error: msg }));
        else console.error(msg);
        process.exit(1);
      }

      // Out of polling window without a verdict.
      const msg = "Timed out waiting for approval. Run agentops login again.";
      if (json) console.log(JSON.stringify({ status: "timeout" }));
      else console.error(msg);
      process.exit(1);
    });

  program
    .command("logout")
    .description("Remove stored AgentOps credentials")
    .action(() => {
      const json = program.opts()["json"] as boolean | undefined;
      const removed = deleteCredentials();
      if (json) {
        console.log(JSON.stringify({ status: removed ? "logged_out" : "not_logged_in" }));
      } else if (removed) {
        console.log(`Removed ${credentialsPath()}.`);
      } else {
        console.log(`Not logged in (no credentials file).`);
      }
    });

  program
    .command("whoami")
    .description("Show the currently signed-in user")
    .action(async () => {
      const json = program.opts()["json"] as boolean | undefined;
      const creds = readCredentials();
      if (!creds) {
        if (json) console.log(JSON.stringify({ status: "not_logged_in" }));
        else console.log(`Not logged in. Run: agentops login --server <url>`);
        return;
      }

      // Verify with the dashboard so a revoked token shows as such.
      try {
        const me = await getJson<MeResponse>(
          `${creds.server.replace(/\/$/, "")}/api/auth/me`,
          creds.token,
        );
        if (me.status === 200 && me.data.user) {
          if (json) {
            console.log(
              JSON.stringify({
                status: "ok",
                server: creds.server,
                user: me.data.user,
              }),
            );
          } else {
            console.log(`Signed in as ${me.data.user.email} (${me.data.user.role})`);
            console.log(`Server:        ${creds.server}`);
            console.log(`Credentials:   ${credentialsPath()}`);
          }
          return;
        }
      } catch {
        // fall through
      }

      // Couldn't verify — token may be revoked or server unreachable.
      if (json) {
        console.log(
          JSON.stringify({
            status: "unverified",
            server: creds.server,
            user: creds.user,
          }),
        );
      } else {
        console.log(
          `Stored credentials for ${creds.user.email} at ${creds.server}, but the dashboard could not verify them. The token may have been revoked.`,
        );
      }
    });
}
