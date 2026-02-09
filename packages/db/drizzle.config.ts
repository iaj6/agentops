import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";
import { homedir } from "node:os";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: resolve(homedir(), ".agentops", "agentops.db"),
  },
});
