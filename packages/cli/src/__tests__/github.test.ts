import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLinkedPR, getIssue, createPR, addPRComment, createCheckRun, isGhAvailable } from "../github.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";

// github.ts now invokes binaries via execFileSync(file, argsArray) — no shell.
// The mocks below reconstruct a "file arg1 arg2 ..." string so the existing
// command-prefix matching keeps working.
const mockExecSync = vi.mocked(execFileSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

// Helper: make gh --version succeed (gh is available)
function mockGhAvailable() {
  mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
    const cmdStr = [file, ...(args ?? [])].join(" ");
    if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
    return "" as any;
  });
}

// Helper: make gh --version throw (gh not available)
function mockGhUnavailable() {
  mockExecSync.mockImplementation(() => {
    throw new Error("command not found: gh");
  });
}

describe("isGhAvailable", () => {
  it("returns true when gh CLI is installed", () => {
    mockExecSync.mockReturnValue("gh version 2.40.0\n" as any);
    expect(isGhAvailable()).toBe(true);
  });

  it("returns false when gh CLI is not installed", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("command not found: gh");
    });
    expect(isGhAvailable()).toBe(false);
  });
});

describe("getLinkedPR", () => {
  it("returns null when gh is not available", () => {
    mockGhUnavailable();
    expect(getLinkedPR("main")).toBeNull();
  });

  it("returns null when no PR exists for the branch", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) return "[]" as any;
      return "" as any;
    });

    expect(getLinkedPR("no-pr-branch")).toBeNull();
  });

  it("parses PR data from gh output", () => {
    const prData = [{
      number: 42,
      title: "Add feature X",
      url: "https://github.com/acme/app/pull/42",
      state: "OPEN",
      headRefName: "feat/x",
      baseRefName: "main",
      additions: 100,
      deletions: 20,
      changedFiles: 5,
    }];

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) return JSON.stringify(prData) as any;
      return "" as any;
    });

    const pr = getLinkedPR("feat/x");
    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(42);
    expect(pr!.title).toBe("Add feature X");
    expect(pr!.url).toBe("https://github.com/acme/app/pull/42");
    expect(pr!.state).toBe("open");
    expect(pr!.headBranch).toBe("feat/x");
    expect(pr!.baseBranch).toBe("main");
    expect(pr!.additions).toBe(100);
    expect(pr!.deletions).toBe(20);
    expect(pr!.changedFiles).toBe(5);
  });

  it("maps MERGED state correctly", () => {
    const prData = [{
      number: 10,
      title: "Merged PR",
      url: "https://github.com/acme/app/pull/10",
      state: "MERGED",
      headRefName: "feat/merged",
      baseRefName: "main",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }];

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) return JSON.stringify(prData) as any;
      return "" as any;
    });

    const pr = getLinkedPR("feat/merged");
    expect(pr!.state).toBe("merged");
  });

  it("maps CLOSED state correctly", () => {
    const prData = [{
      number: 11,
      title: "Closed PR",
      url: "https://github.com/acme/app/pull/11",
      state: "CLOSED",
      headRefName: "feat/closed",
      baseRefName: "main",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    }];

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) return JSON.stringify(prData) as any;
      return "" as any;
    });

    const pr = getLinkedPR("feat/closed");
    expect(pr!.state).toBe("closed");
  });

  it("uses current branch when no branch argument provided", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) {
        // When no branch arg, there should be no --head flag
        expect(cmdStr).not.toContain("--head");
        return "[]" as any;
      }
      return "" as any;
    });

    getLinkedPR();
  });

  it("returns null when gh returns invalid JSON", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr list")) return "not json" as any;
      return "" as any;
    });

    expect(getLinkedPR("main")).toBeNull();
  });
});

describe("getIssue", () => {
  it("returns null when gh is not available", () => {
    mockGhUnavailable();
    expect(getIssue(123)).toBeNull();
  });

  it("parses issue data from gh output", () => {
    const issueData = {
      number: 99,
      title: "Bug report: login fails",
      url: "https://github.com/acme/app/issues/99",
      state: "OPEN",
      labels: [{ name: "bug" }, { name: "high-priority" }],
    };

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh issue view")) return JSON.stringify(issueData) as any;
      return "" as any;
    });

    const issue = getIssue(99);
    expect(issue).not.toBeNull();
    expect(issue!.number).toBe(99);
    expect(issue!.title).toBe("Bug report: login fails");
    expect(issue!.state).toBe("open");
    expect(issue!.labels).toEqual(["bug", "high-priority"]);
  });

  it("handles closed issue state", () => {
    const issueData = {
      number: 50,
      title: "Resolved issue",
      url: "https://github.com/acme/app/issues/50",
      state: "CLOSED",
      labels: [],
    };

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh issue view")) return JSON.stringify(issueData) as any;
      return "" as any;
    });

    const issue = getIssue(50);
    expect(issue!.state).toBe("closed");
  });

  it("returns null when issue not found", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh issue view")) return "" as any;
      return "" as any;
    });

    expect(getIssue(999)).toBeNull();
  });

  it("handles issue with no labels", () => {
    const issueData = {
      number: 10,
      title: "No labels",
      url: "https://github.com/acme/app/issues/10",
      state: "OPEN",
      labels: [],
    };

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh issue view")) return JSON.stringify(issueData) as any;
      return "" as any;
    });

    const issue = getIssue(10);
    expect(issue!.labels).toEqual([]);
  });
});

describe("createPR", () => {
  it("returns null when gh is not available", () => {
    mockGhUnavailable();
    expect(createPR("title", "body")).toBeNull();
  });

  it("creates a PR and returns parsed data", () => {
    const prData = {
      number: 55,
      title: "New feature",
      url: "https://github.com/acme/app/pull/55",
      state: "OPEN",
      headRefName: "feat/new",
      baseRefName: "main",
      additions: 50,
      deletions: 10,
      changedFiles: 3,
    };

    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr create")) return JSON.stringify(prData) as any;
      return "" as any;
    });

    const pr = createPR("New feature", "Description of the feature", "main");
    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(55);
    expect(pr!.title).toBe("New feature");
  });

  it("returns null when gh pr create fails", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      // All gh commands return empty (failure)
      return "" as any;
    });

    expect(createPR("title", "body")).toBeNull();
  });
});

describe("addPRComment", () => {
  it("returns false when gh is not available", () => {
    mockGhUnavailable();
    expect(addPRComment(42, "comment")).toBe(false);
  });

  it("returns true on success", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("gh pr comment")) return "https://github.com/acme/app/pull/42#comment" as any;
      return "" as any;
    });

    expect(addPRComment(42, "Looks good!")).toBe(true);
  });

  it("returns false when comment fails", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      return "" as any;
    });

    expect(addPRComment(42, "comment")).toBe(false);
  });
});

describe("createCheckRun", () => {
  it("returns null when gh is not available", () => {
    mockGhUnavailable();
    expect(createCheckRun("test", "completed", "success")).toBeNull();
  });

  it("returns check object with provided values", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("git rev-parse")) return "abc123def\n" as any;
      if (cmdStr.startsWith("gh api")) return "{}" as any;
      return "" as any;
    });

    const check = createCheckRun("CI Check", "completed", "success", "https://ci.example.com/run/1");
    expect(check).not.toBeNull();
    expect(check!.name).toBe("CI Check");
    expect(check!.status).toBe("completed");
    expect(check!.conclusion).toBe("success");
    expect(check!.url).toBe("https://ci.example.com/run/1");
  });

  it("returns null when HEAD sha cannot be resolved", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("git rev-parse")) throw new Error("not a git repo");
      return "" as any;
    });

    expect(createCheckRun("test", "completed", "success")).toBeNull();
  });
});

// Injection-fix guard: untrusted text (PR/comment bodies, check-run payloads)
// must travel via stdin (the execFileSync `input` option), never embedded in
// argv — and there must be no shell. These assertions FAIL against vulnerable
// inline-argv code like gh(['pr','create','--title',t,'--body',body]).
describe("argument safety (no shell injection surface)", () => {
  // Each recorded call is [file, argsArray, options]; pull out file/args/input.
  function calls() {
    return mockExecSync.mock.calls.map((c) => ({
      file: c[0] as string,
      args: (c[1] as string[]) ?? [],
      input: (c[2] as { input?: string } | undefined)?.input,
    }));
  }

  it("createPR pipes the body via stdin, never argv", () => {
    mockGhAvailable();
    const body = "evil $(rm -rf /) `whoami`\nsecond line";
    const title = "title with `backticks` and $(subshell)";
    createPR(title, body, "main");

    const call = calls().find((c) => c.args[0] === "pr" && c.args[1] === "create");
    expect(call).toBeDefined();
    expect(call!.args).toContain("--body-file");
    expect(call!.args).toContain("-");
    expect(call!.args).not.toContain(body); // body is NOT in argv
    expect(call!.input).toBe(body); // body arrives via stdin
    // Title is passed as a single argv element — no shell, so metacharacters
    // are literal, not interpreted.
    expect(call!.args).toContain(title);
  });

  it("addPRComment pipes the comment body via stdin, never argv", () => {
    mockGhAvailable();
    const body = "$(curl http://evil) `id` payload";
    addPRComment(42, body);

    const call = calls().find((c) => c.args[0] === "pr" && c.args[1] === "comment");
    expect(call).toBeDefined();
    expect(call!.args).toContain("--body-file");
    expect(call!.args).toContain("-");
    expect(call!.args).not.toContain(body);
    expect(call!.input).toBe(body);
  });

  it("createCheckRun sends a JSON payload via stdin (--input -), never argv", () => {
    mockExecSync.mockImplementation((file: string, args?: readonly string[]) => {
      const cmdStr = [file, ...(args ?? [])].join(" ");
      if (cmdStr === "gh --version") return "gh version 2.40.0\n" as any;
      if (cmdStr.startsWith("git rev-parse")) return "abc123def\n" as any;
      return "" as any;
    });
    createCheckRun("name `id`", "completed", "failure", "https://x/$(id)");

    const call = calls().find((c) => c.args[0] === "api");
    expect(call).toBeDefined();
    expect(call!.args).toContain("--input");
    expect(call!.args).toContain("-");
    // Raw metacharacters never reach argv...
    expect(call!.args.join(" ")).not.toContain("$(id)");
    // ...they're carried as a well-formed JSON document over stdin.
    const payload = JSON.parse(call!.input as string) as Record<string, unknown>;
    expect(payload.name).toBe("name `id`");
    expect(payload.head_sha).toBe("abc123def");
    expect(payload.conclusion).toBe("failure");
    expect(payload.details_url).toBe("https://x/$(id)");
  });
});
