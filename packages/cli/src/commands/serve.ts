import { Command } from "commander";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the AgentOps web dashboard")
    .option("--port <port>", "Port to serve on", "3000")
    .option(
      "--host <host>",
      "Host interface to bind (use 0.0.0.0 to expose on LAN)",
      "127.0.0.1",
    )
    .action((opts: { port: string; host: string }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const port = opts.port;
      const host = opts.host;

      // Validate the port before spawning so an invalid value fails fast with
      // a clear message instead of a confusing URL or a thrown RangeError.
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        console.error(`Invalid --port "${port}": must be an integer in 1-65535.`);
        process.exit(1);
      }

      // Find the web package wherever it's installed
      const require = createRequire(import.meta.url);
      let webPkgDir: string;
      try {
        const webPkgPath = require.resolve("@agentops/web/package.json");
        webPkgDir = dirname(webPkgPath);
      } catch {
        console.error(
          "Could not find @agentops/web. Install it with: npm install -g @agentops/web",
        );
        process.exit(1);
      }

      const serverPath = join(
        webPkgDir,
        ".next",
        "standalone",
        "packages",
        "web",
        "server.js",
      );

      if (!existsSync(serverPath)) {
        console.error(
          "Web package found but standalone build is missing. Rebuild with: npm run build --workspace=packages/web",
        );
        process.exit(1);
      }

      const displayHost = host === "0.0.0.0" ? "localhost" : host;
      console.log(`AgentOps dashboard starting at http://${displayHost}:${port}`);
      if (host !== "127.0.0.1" && host !== "localhost") {
        console.warn(
          `Note: dashboard is binding to ${host} and reachable from the network. `
          + `The API requires authentication (run 'agentops login' to create the first `
          + `admin), but traffic is plain HTTP — put it behind TLS for anything beyond `
          + `a trusted LAN (see docker-compose.yml's caddy profile).`,
        );
      }

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PORT: port,
        HOSTNAME: host,
      };

      if (dbPath) {
        env["AGENTOPS_DB_PATH"] = dbPath;
      }

      const child = spawn("node", [serverPath], {
        stdio: "inherit",
        env,
      });

      child.on("error", (err) => {
        console.error(`Failed to start dashboard: ${err.message}`);
        process.exit(1);
      });

      child.on("close", (code) => {
        process.exit(code ?? 0);
      });

      // Graceful shutdown
      const shutdown = () => {
        child.kill("SIGTERM");
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
