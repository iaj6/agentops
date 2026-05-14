import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Route-handler tests run in Node — they import @agentops/db (better-sqlite3)
// and Next's Web-style fetch/Request primitives, both Node-compatible.

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // The dashboard tests share helpers from a setup file that injects a
    // per-test in-memory SQLite via vi.mock("@/lib/db", ...).
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Mirror the "@/*" → "./src/*" path that tsconfig + Next use.
      "@": path.resolve(here, "src"),
    },
  },
});
