import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../connection.js";
import { insertRun, searchRuns, countRuns, getDistinctRepos, getDistinctBranches } from "../runs.js";
import type { AgentOpsDb } from "../connection.js";
import type { Run } from "@agentops/core";
import { createRunId, RunStatus } from "@agentops/core";

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id: createRunId(id),
    status: RunStatus.Running,
    goal: {
      humanReadable: "Test goal",
      structured: { type: "task", description: "Test goal", parameters: {} },
    },
    agents: [],
    environment: {
      repo: "test/repo",
      branch: "main",
      permissions: [],
      sandbox: { enabled: false, isolationLevel: "none" },
    },
    actions: [],
    artifacts: [],
    metrics: {
      tokenUsage: { input: 100, output: 50, total: 150 },
      wallTimeMs: 1000,
      costUsd: 0.5,
      flakeRate: 0,
    },
    evaluations: [],
    decisions: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("searchRuns", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  describe("text search (q)", () => {
    it("matches on goal text", () => {
      insertRun(db, makeRun("run_1", {
        goal: { humanReadable: "Fix authentication bug", structured: { type: "task", description: "Fix auth", parameters: {} } },
      }));
      insertRun(db, makeRun("run_2", {
        goal: { humanReadable: "Add logging", structured: { type: "task", description: "Add logging", parameters: {} } },
      }));

      const results = searchRuns(db, { q: "authentication" });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_1");
    });

    it("matches on repo name", () => {
      insertRun(db, makeRun("run_1", {
        environment: { repo: "acme/backend", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertRun(db, makeRun("run_2", {
        environment: { repo: "acme/frontend", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const results = searchRuns(db, { q: "backend" });
      expect(results).toHaveLength(1);
      expect(results[0]!.environment.repo).toBe("acme/backend");
    });

    it("matches on branch name", () => {
      insertRun(db, makeRun("run_1", {
        environment: { repo: "test/repo", branch: "feat/new-api", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertRun(db, makeRun("run_2", {
        environment: { repo: "test/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const results = searchRuns(db, { q: "new-api" });
      expect(results).toHaveLength(1);
      expect(results[0]!.environment.branch).toBe("feat/new-api");
    });

    it("returns all runs when q is empty", () => {
      insertRun(db, makeRun("run_1"));
      insertRun(db, makeRun("run_2"));

      const results = searchRuns(db, {});
      expect(results).toHaveLength(2);
    });
  });

  describe("status filter", () => {
    it("filters by single status", () => {
      insertRun(db, makeRun("run_1", { status: RunStatus.Running }));
      insertRun(db, makeRun("run_2", { status: RunStatus.Completed }));
      insertRun(db, makeRun("run_3", { status: RunStatus.Failed }));

      const results = searchRuns(db, { status: ["completed"] });
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe(RunStatus.Completed);
    });

    it("filters by multiple statuses", () => {
      insertRun(db, makeRun("run_1", { status: RunStatus.Running }));
      insertRun(db, makeRun("run_2", { status: RunStatus.Completed }));
      insertRun(db, makeRun("run_3", { status: RunStatus.Failed }));

      const results = searchRuns(db, { status: ["running", "failed"] });
      expect(results).toHaveLength(2);
      const statuses = results.map((r) => r.status);
      expect(statuses).toContain(RunStatus.Running);
      expect(statuses).toContain(RunStatus.Failed);
    });
  });

  describe("repo filter", () => {
    it("filters by repository", () => {
      insertRun(db, makeRun("run_1", {
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertRun(db, makeRun("run_2", {
        environment: { repo: "acme/lib", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertRun(db, makeRun("run_3", {
        environment: { repo: "other/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const results = searchRuns(db, { repo: ["acme/app", "acme/lib"] });
      expect(results).toHaveLength(2);
    });
  });

  describe("branch filter", () => {
    it("filters by branch", () => {
      insertRun(db, makeRun("run_1", {
        environment: { repo: "test/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));
      insertRun(db, makeRun("run_2", {
        environment: { repo: "test/repo", branch: "develop", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
      }));

      const results = searchRuns(db, { branch: ["main"] });
      expect(results).toHaveLength(1);
      expect(results[0]!.environment.branch).toBe("main");
    });
  });

  describe("date range filter", () => {
    it("filters by from date", () => {
      insertRun(db, makeRun("run_old", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_new", { createdAt: "2025-06-15T00:00:00.000Z" }));

      const results = searchRuns(db, { from: "2025-03-01T00:00:00.000Z" });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_new");
    });

    it("filters by to date", () => {
      insertRun(db, makeRun("run_old", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_new", { createdAt: "2025-06-15T00:00:00.000Z" }));

      const results = searchRuns(db, { to: "2025-03-01T00:00:00.000Z" });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_old");
    });

    it("filters by date range", () => {
      insertRun(db, makeRun("run_1", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_2", { createdAt: "2025-03-15T00:00:00.000Z" }));
      insertRun(db, makeRun("run_3", { createdAt: "2025-06-15T00:00:00.000Z" }));

      const results = searchRuns(db, {
        from: "2025-02-01T00:00:00.000Z",
        to: "2025-05-01T00:00:00.000Z",
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_2");
    });
  });

  describe("cost range filter", () => {
    it("filters by minimum cost", () => {
      insertRun(db, makeRun("run_cheap", {
        metrics: { tokenUsage: { input: 10, output: 5, total: 15 }, wallTimeMs: 100, costUsd: 0.1, flakeRate: 0 },
      }));
      insertRun(db, makeRun("run_expensive", {
        metrics: { tokenUsage: { input: 1000, output: 500, total: 1500 }, wallTimeMs: 10000, costUsd: 5.0, flakeRate: 0 },
      }));

      const results = searchRuns(db, { minCost: 1.0 });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_expensive");
    });

    it("filters by maximum cost", () => {
      insertRun(db, makeRun("run_cheap", {
        metrics: { tokenUsage: { input: 10, output: 5, total: 15 }, wallTimeMs: 100, costUsd: 0.1, flakeRate: 0 },
      }));
      insertRun(db, makeRun("run_expensive", {
        metrics: { tokenUsage: { input: 1000, output: 500, total: 1500 }, wallTimeMs: 10000, costUsd: 5.0, flakeRate: 0 },
      }));

      const results = searchRuns(db, { maxCost: 1.0 });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_cheap");
    });

    it("filters by cost range", () => {
      insertRun(db, makeRun("run_1", {
        metrics: { tokenUsage: { input: 10, output: 5, total: 15 }, wallTimeMs: 100, costUsd: 0.1, flakeRate: 0 },
      }));
      insertRun(db, makeRun("run_2", {
        metrics: { tokenUsage: { input: 100, output: 50, total: 150 }, wallTimeMs: 1000, costUsd: 1.0, flakeRate: 0 },
      }));
      insertRun(db, makeRun("run_3", {
        metrics: { tokenUsage: { input: 1000, output: 500, total: 1500 }, wallTimeMs: 10000, costUsd: 5.0, flakeRate: 0 },
      }));

      const results = searchRuns(db, { minCost: 0.5, maxCost: 2.0 });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_2");
    });
  });

  describe("compound filters", () => {
    it("combines status + repo + date range", () => {
      insertRun(db, makeRun("run_match", {
        status: RunStatus.Completed,
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
        createdAt: "2025-03-15T00:00:00.000Z",
      }));
      insertRun(db, makeRun("run_wrong_status", {
        status: RunStatus.Failed,
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
        createdAt: "2025-03-15T00:00:00.000Z",
      }));
      insertRun(db, makeRun("run_wrong_repo", {
        status: RunStatus.Completed,
        environment: { repo: "other/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
        createdAt: "2025-03-15T00:00:00.000Z",
      }));
      insertRun(db, makeRun("run_wrong_date", {
        status: RunStatus.Completed,
        environment: { repo: "acme/app", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
        createdAt: "2025-01-01T00:00:00.000Z",
      }));

      const results = searchRuns(db, {
        status: ["completed"],
        repo: ["acme/app"],
        from: "2025-02-01T00:00:00.000Z",
        to: "2025-04-01T00:00:00.000Z",
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_match");
    });

    it("combines text search + status filter", () => {
      insertRun(db, makeRun("run_1", {
        status: RunStatus.Completed,
        goal: { humanReadable: "Fix login bug", structured: { type: "task", description: "Fix login", parameters: {} } },
      }));
      insertRun(db, makeRun("run_2", {
        status: RunStatus.Running,
        goal: { humanReadable: "Fix login performance", structured: { type: "task", description: "Fix login perf", parameters: {} } },
      }));
      insertRun(db, makeRun("run_3", {
        status: RunStatus.Completed,
        goal: { humanReadable: "Add dashboard", structured: { type: "task", description: "Add dashboard", parameters: {} } },
      }));

      const results = searchRuns(db, { q: "login", status: ["completed"] });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("run_1");
    });
  });

  describe("sorting", () => {
    it("sorts by created date descending by default", () => {
      insertRun(db, makeRun("run_old", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_mid", { createdAt: "2025-03-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_new", { createdAt: "2025-06-01T00:00:00.000Z" }));

      const results = searchRuns(db, {});
      expect(results[0]!.id).toBe("run_new");
      expect(results[1]!.id).toBe("run_mid");
      expect(results[2]!.id).toBe("run_old");
    });

    it("sorts by created date ascending", () => {
      insertRun(db, makeRun("run_old", { createdAt: "2025-01-01T00:00:00.000Z" }));
      insertRun(db, makeRun("run_new", { createdAt: "2025-06-01T00:00:00.000Z" }));

      const results = searchRuns(db, { sortBy: "created", sortDir: "asc" });
      expect(results[0]!.id).toBe("run_old");
      expect(results[1]!.id).toBe("run_new");
    });

    it("sorts by status", () => {
      insertRun(db, makeRun("run_running", { status: RunStatus.Running }));
      insertRun(db, makeRun("run_completed", { status: RunStatus.Completed }));
      insertRun(db, makeRun("run_failed", { status: RunStatus.Failed }));

      const results = searchRuns(db, { sortBy: "status", sortDir: "asc" });
      expect(results).toHaveLength(3);
      // Alphabetical: completed < failed < running
      expect(results[0]!.status).toBe("completed");
      expect(results[1]!.status).toBe("failed");
      expect(results[2]!.status).toBe("running");
    });
  });

  describe("pagination", () => {
    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        insertRun(db, makeRun(`run_${i}`));
      }

      const results = searchRuns(db, { limit: 3 });
      expect(results).toHaveLength(3);
    });

    it("respects offset", () => {
      for (let i = 0; i < 5; i++) {
        insertRun(db, makeRun(`run_${i}`, {
          createdAt: `2025-01-0${i + 1}T00:00:00.000Z`,
        }));
      }

      const results = searchRuns(db, { limit: 2, offset: 2, sortBy: "created", sortDir: "asc" });
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("run_2");
      expect(results[1]!.id).toBe("run_3");
    });

    it("defaults to limit 50", () => {
      for (let i = 0; i < 60; i++) {
        insertRun(db, makeRun(`run_${i}`));
      }

      const results = searchRuns(db, {});
      expect(results).toHaveLength(50);
    });
  });

  describe("empty results", () => {
    it("returns empty array when no runs exist", () => {
      const results = searchRuns(db, { q: "nonexistent" });
      expect(results).toEqual([]);
    });

    it("returns empty array when filters exclude all runs", () => {
      insertRun(db, makeRun("run_1", { status: RunStatus.Running }));

      const results = searchRuns(db, { status: ["completed"] });
      expect(results).toEqual([]);
    });
  });
});

describe("countRuns", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("counts all runs when no filters", () => {
    insertRun(db, makeRun("run_1"));
    insertRun(db, makeRun("run_2"));
    insertRun(db, makeRun("run_3"));

    expect(countRuns(db, {})).toBe(3);
  });

  it("counts filtered runs", () => {
    insertRun(db, makeRun("run_1", { status: RunStatus.Completed }));
    insertRun(db, makeRun("run_2", { status: RunStatus.Running }));
    insertRun(db, makeRun("run_3", { status: RunStatus.Completed }));

    expect(countRuns(db, { status: ["completed"] })).toBe(2);
  });

  it("returns 0 when no runs match", () => {
    insertRun(db, makeRun("run_1", { status: RunStatus.Running }));

    expect(countRuns(db, { status: ["failed"] })).toBe(0);
  });

  it("returns 0 when database is empty", () => {
    expect(countRuns(db, {})).toBe(0);
  });
});

describe("getDistinctRepos", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("returns unique repo names sorted alphabetically", () => {
    insertRun(db, makeRun("run_1", {
      environment: { repo: "zeta/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));
    insertRun(db, makeRun("run_2", {
      environment: { repo: "alpha/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));
    insertRun(db, makeRun("run_3", {
      environment: { repo: "alpha/repo", branch: "develop", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));

    const repos = getDistinctRepos(db);
    expect(repos).toEqual(["alpha/repo", "zeta/repo"]);
  });

  it("returns empty array when no runs exist", () => {
    expect(getDistinctRepos(db)).toEqual([]);
  });
});

describe("getDistinctBranches", () => {
  let db: AgentOpsDb;

  beforeEach(() => {
    db = getDb(":memory:");
  });

  it("returns unique branch names sorted alphabetically", () => {
    insertRun(db, makeRun("run_1", {
      environment: { repo: "test/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));
    insertRun(db, makeRun("run_2", {
      environment: { repo: "test/repo", branch: "develop", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));
    insertRun(db, makeRun("run_3", {
      environment: { repo: "other/repo", branch: "main", permissions: [], sandbox: { enabled: false, isolationLevel: "none" } },
    }));

    const branches = getDistinctBranches(db);
    expect(branches).toEqual(["develop", "main"]);
  });

  it("returns empty array when no runs exist", () => {
    expect(getDistinctBranches(db)).toEqual([]);
  });
});
