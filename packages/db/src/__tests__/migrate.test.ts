import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../migrate.js";

describe("migrate", () => {
  it("is idempotent — re-running tolerates duplicate ADD COLUMN without throwing", () => {
    const sqlite = new Database(":memory:");
    migrate(sqlite);
    // The second run hits "duplicate column name" on the ALTERs; that's the
    // ONLY error addColumnIfMissing swallows. It must not throw.
    expect(() => migrate(sqlite)).not.toThrow();
    sqlite.close();
  });

  it("adds the ALTER-only columns (user_id, summary, github) so queries don't hit 'no such column'", () => {
    const sqlite = new Database(":memory:");
    migrate(sqlite);
    const runCols = (sqlite.prepare(`PRAGMA table_info(runs)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(runCols).toContain("user_id");
    expect(runCols).toContain("summary");
    expect(runCols).toContain("github");
    const sessCols = (sqlite.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(sessCols).toContain("user_id");
    sqlite.close();
  });
});
