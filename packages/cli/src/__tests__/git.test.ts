import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentRepo, getCurrentBranch, getChangedFiles, getWorkingTreeDiff } from "../git.js";

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

  it("normalizes a mixed-case remote to lowercase owner/name", () => {
    // Two case variants of the same GitHub repo must collapse to one bucket.
    mockExecSync.mockReturnValue("git@github.com:Iaj6/AgentOps.git\n");
    expect(getCurrentRepo()).toBe("iaj6/agentops");
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

  it("passes cwd through to git when provided", () => {
    // finalizeSession runs in the hook subprocess, whose cwd is wherever
    // Claude Code was launched from — the status must run in the tracked
    // repo (state.cwd) or the run records another repo's changes.
    mockExecSync.mockReturnValue("M  src/index.ts\n");
    getChangedFiles("/some/working/dir");
    const [, opts] = mockExecSync.mock.calls[0]!;
    expect((opts as { cwd?: string }).cwd).toBe("/some/working/dir");
  });

  it("does not set cwd when none is provided", () => {
    mockExecSync.mockReturnValue("\n");
    getChangedFiles();
    const [, opts] = mockExecSync.mock.calls[0]!;
    expect((opts as { cwd?: string }).cwd).toBeUndefined();
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

  it("passes cwd through to git when provided", () => {
    mockExecSync.mockReturnValue("+new line\n");
    getWorkingTreeDiff("/some/working/dir");
    expect(mockExecSync).toHaveBeenCalledWith(
      "git diff HEAD",
      expect.objectContaining({ cwd: "/some/working/dir" }),
    );
  });
});
