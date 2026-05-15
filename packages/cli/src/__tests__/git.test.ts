import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentRepo, getCurrentBranch, getDiff, getChangedFiles, getCommitLog, snapshotRef, getWorkingTreeDiff } from "../git.js";

// Mock child_process.execSync
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("getCurrentRepo", () => {
  it("parses SSH remote URL", () => {
    mockExecSync.mockReturnValue("git@github.com:acme/backend.git\n");
    expect(getCurrentRepo()).toBe("acme/backend");
  });

  it("parses HTTPS remote URL", () => {
    mockExecSync.mockReturnValue("https://github.com/acme/backend.git\n");
    expect(getCurrentRepo()).toBe("acme/backend");
  });

  it("parses HTTPS URL without .git suffix", () => {
    mockExecSync.mockReturnValue("https://github.com/acme/backend\n");
    expect(getCurrentRepo()).toBe("acme/backend");
  });

  it("returns 'unknown' when git remote fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(getCurrentRepo()).toBe("unknown");
  });

  it("falls back to upstream when origin is missing", () => {
    // First call (origin) fails, second (upstream) returns a URL.
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("No such remote 'origin'");
      })
      .mockReturnValueOnce("git@github.com:acme/forked.git\n");
    expect(getCurrentRepo()).toBe("acme/forked");
  });

  it("falls back to repo basename when no remotes are configured", () => {
    // All remote lookups fail, rev-parse --show-toplevel returns a path.
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error("No such remote 'origin'");
      })
      .mockImplementationOnce(() => {
        throw new Error("No such remote 'upstream'");
      })
      .mockImplementationOnce(() => {
        throw new Error("No such remote 'github'");
      })
      .mockReturnValueOnce("/Users/foo/projects/my-cool-repo\n");
    expect(getCurrentRepo()).toBe("my-cool-repo");
  });

  it("passes cwd through to git when provided", () => {
    mockExecSync.mockReturnValue("git@github.com:acme/backend.git\n");
    getCurrentRepo("/some/working/dir");
    // First call was `git remote get-url origin` — verify cwd reached execSync.
    const [, opts] = mockExecSync.mock.calls[0]!;
    expect((opts as { cwd?: string }).cwd).toBe("/some/working/dir");
  });
});

describe("getCurrentBranch", () => {
  it("returns the current branch name", () => {
    mockExecSync.mockReturnValue("feat/my-feature\n");
    expect(getCurrentBranch()).toBe("feat/my-feature");
  });

  it("returns 'unknown' when git fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(getCurrentBranch()).toBe("unknown");
  });
});

describe("getDiff", () => {
  it("gets diff between two refs", () => {
    mockExecSync.mockReturnValue("+added line\n");
    const result = getDiff("abc123", "def456");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff abc123 def456",
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(result).toBe("+added line");
  });

  it("gets diff from a single ref", () => {
    mockExecSync.mockReturnValue("-removed\n");
    getDiff("abc123");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff abc123",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("defaults to diff HEAD when no refs given", () => {
    mockExecSync.mockReturnValue("some diff\n");
    getDiff();
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff HEAD",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("returns empty string when git fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(getDiff()).toBe("");
  });
});

describe("getChangedFiles", () => {
  it("parses porcelain status output", () => {
    // Note: git() trims the full output, so leading space on first line is lost.
    // Use M_ (modified in index) rather than _M (modified in worktree) for first entry.
    mockExecSync.mockReturnValue(
      "M  src/index.ts\n?? src/new-file.ts\n D src/deleted.ts\n",
    );
    const files = getChangedFiles();
    expect(files).toEqual([
      { status: "modified", path: "src/index.ts" },
      { status: "added", path: "src/new-file.ts" },
      { status: "deleted", path: "src/deleted.ts" },
    ]);
  });

  it("handles added files (A status)", () => {
    mockExecSync.mockReturnValue("A  src/staged.ts\n");
    const files = getChangedFiles();
    expect(files).toEqual([{ status: "added", path: "src/staged.ts" }]);
  });

  it("handles renamed files (R status)", () => {
    mockExecSync.mockReturnValue("R  src/old.ts -> src/new.ts\n");
    const files = getChangedFiles();
    expect(files[0]!.status).toBe("renamed");
  });

  it("returns empty array when no changes", () => {
    mockExecSync.mockReturnValue("\n");
    expect(getChangedFiles()).toEqual([]);
  });

  it("returns empty array when git fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(getChangedFiles()).toEqual([]);
  });
});

describe("getCommitLog", () => {
  it("returns commit log output", () => {
    mockExecSync.mockReturnValue("abc1234 Initial commit\ndef5678 Second commit\n");
    const log = getCommitLog();
    expect(log).toContain("abc1234 Initial commit");
  });

  it("passes since argument when provided", () => {
    mockExecSync.mockReturnValue("abc1234 Recent commit\n");
    getCommitLog("2025-01-01");
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--since="2025-01-01"'),
      expect.anything(),
    );
  });

  it("defaults to -10 when no since provided", () => {
    mockExecSync.mockReturnValue("some log\n");
    getCommitLog();
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("-10"),
      expect.anything(),
    );
  });
});

describe("snapshotRef", () => {
  it("returns stash create result when available", () => {
    mockExecSync.mockReturnValueOnce("abc123def\n");
    expect(snapshotRef()).toBe("abc123def");
  });

  it("falls back to rev-parse HEAD when stash create returns empty", () => {
    mockExecSync
      .mockReturnValueOnce("\n") // stash create returns empty
      .mockReturnValueOnce("deadbeef\n"); // rev-parse HEAD
    expect(snapshotRef()).toBe("deadbeef");
  });

  it("returns empty string when both fail", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(snapshotRef()).toBe("");
  });
});

describe("getWorkingTreeDiff", () => {
  it("returns diff HEAD output", () => {
    mockExecSync.mockReturnValue("+new line\n-old line\n");
    const diff = getWorkingTreeDiff();
    expect(diff).toBe("+new line\n-old line");
  });

  it("returns empty string when no diff", () => {
    mockExecSync.mockReturnValue("\n");
    expect(getWorkingTreeDiff()).toBe("");
  });
});
