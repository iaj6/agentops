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
          `WARNING: dashboard is binding to ${host}. The API is currently unauthenticated — `
          + `anyone with network reach can read and mutate data. Bind to 127.0.0.1 unless `
          + `you have added auth.`,
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
