import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLinkedPR, getIssue, isGhAvailable } from "../github.js";

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

