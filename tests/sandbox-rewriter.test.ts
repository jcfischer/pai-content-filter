import { describe, test, expect } from "bun:test";
import {
  extractRepoName,
  rewriteCommand,
  buildHookOutput,
} from "../src/lib/sandbox-rewriter";
import type { ParsedCommand, CommandType } from "../src/lib/types";

// ============================================================
// Test helpers
// ============================================================

const SANDBOX = "/home/user/sandbox";

function makeParsed(
  overrides: Partial<ParsedCommand> & { type: CommandType; raw: string }
): ParsedCommand {
  return {
    url: null,
    destination: null,
    flags: [],
    tokens: overrides.raw.split(/\s+/),
    ...overrides,
  };
}

// ============================================================
// extractRepoName
// ============================================================

describe("extractRepoName", () => {
  test("HTTPS GitHub URL with .git suffix", () => {
    expect(extractRepoName("https://github.com/owner/repo.git")).toBe("repo");
  });

  test("HTTPS GitHub URL without .git suffix", () => {
    expect(extractRepoName("https://github.com/owner/repo")).toBe("repo");
  });

  test("SSH GitHub URL with .git suffix", () => {
    expect(extractRepoName("git@github.com:owner/repo.git")).toBe("repo");
  });

  test("GitLab nested group URL with .git suffix", () => {
    expect(extractRepoName("https://gitlab.com/group/sub/repo.git")).toBe(
      "repo"
    );
  });

  test("URL with trailing slash", () => {
    expect(extractRepoName("https://github.com/owner/repo/")).toBe("repo");
  });

  test("gh short format owner/repo", () => {
    expect(extractRepoName("owner/repo")).toBe("repo");
  });

  test("empty string returns fallback", () => {
    expect(extractRepoName("")).toBe("download");
  });

  test("URL with no repo name returns fallback", () => {
    expect(extractRepoName("https://example.com/")).toBe("download");
  });
});

// ============================================================
// rewriteCommand — git-clone
// ============================================================

describe("rewriteCommand — git-clone", () => {
  test("no destination in rewrite mode appends sandbox/repoName", () => {
    const parsed = makeParsed({
      type: "git-clone",
      url: "https://github.com/owner/myrepo.git",
      raw: "git clone https://github.com/owner/myrepo.git",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe(
      "git clone https://github.com/owner/myrepo.git /home/user/sandbox/myrepo"
    );
    expect(result.newPath).toBe("/home/user/sandbox/myrepo");
    expect(result.original).toBe(
      "git clone https://github.com/owner/myrepo.git"
    );
  });

  test("destination outside sandbox rewrites to sandbox/basename", () => {
    const parsed = makeParsed({
      type: "git-clone",
      url: "https://github.com/owner/myrepo.git",
      destination: "/tmp/myrepo",
      raw: "git clone https://github.com/owner/myrepo.git /tmp/myrepo",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe(
      "git clone https://github.com/owner/myrepo.git /home/user/sandbox/myrepo"
    );
    expect(result.newPath).toBe("/home/user/sandbox/myrepo");
  });

  test("destination inside sandbox is unchanged", () => {
    const parsed = makeParsed({
      type: "git-clone",
      url: "https://github.com/owner/myrepo.git",
      destination: "/home/user/sandbox/myrepo",
      raw: "git clone https://github.com/owner/myrepo.git /home/user/sandbox/myrepo",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe(parsed.raw);
    expect(result.newPath).toBe(null);
  });

  test("destination is '.' rewrites to sandbox path", () => {
    const parsed = makeParsed({
      type: "git-clone",
      url: "https://github.com/owner/myrepo.git",
      destination: ".",
      raw: "git clone https://github.com/owner/myrepo.git .",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe(
      "git clone https://github.com/owner/myrepo.git /home/user/sandbox/myrepo"
    );
    expect(result.newPath).toBe("/home/user/sandbox/myrepo");
  });

  test("block mode with needed rewrite signals changed but no rewrite", () => {
    const parsed = makeParsed({
      type: "git-clone",
      url: "https://github.com/owner/myrepo.git",
      destination: "/tmp/myrepo",
      raw: "git clone https://github.com/owner/myrepo.git /tmp/myrepo",
    });
    const result = rewriteCommand(parsed, SANDBOX, "block");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe(parsed.raw);
    expect(result.newPath).toBe(null);
  });
});

// ============================================================
// rewriteCommand — gh-clone
// ============================================================

describe("rewriteCommand — gh-clone", () => {
  test("no destination appends sandbox/repoName", () => {
    const parsed = makeParsed({
      type: "gh-clone",
      url: "owner/myrepo",
      raw: "gh repo clone owner/myrepo",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe(
      "gh repo clone owner/myrepo /home/user/sandbox/myrepo"
    );
    expect(result.newPath).toBe("/home/user/sandbox/myrepo");
  });
});

// ============================================================
// rewriteCommand — curl-download
// ============================================================

describe("rewriteCommand — curl-download", () => {
  test("-o outside sandbox rewrites to sandbox/basename", () => {
    const parsed = makeParsed({
      type: "curl-download",
      url: "https://example.com/data.json",
      destination: "file.json",
      raw: "curl -o file.json https://example.com/data.json",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toContain("/home/user/sandbox/file.json");
    expect(result.newPath).toBe("/home/user/sandbox/file.json");
  });

  test("-o inside sandbox is unchanged", () => {
    const parsed = makeParsed({
      type: "curl-download",
      url: "https://example.com/data.json",
      destination: "/home/user/sandbox/file.json",
      raw: "curl -o /home/user/sandbox/file.json https://example.com/data.json",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe(parsed.raw);
  });

  test("flag position: url before -o still rewrites correctly", () => {
    const parsed = makeParsed({
      type: "curl-download",
      url: "https://example.com/data.json",
      destination: "file.json",
      raw: "curl https://example.com/data.json -o file.json",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toContain("/home/user/sandbox/file.json");
    expect(result.newPath).toBe("/home/user/sandbox/file.json");
  });
});

// ============================================================
// rewriteCommand — wget-download
// ============================================================

describe("rewriteCommand — wget-download", () => {
  test("-O outside sandbox rewrites to sandbox/basename", () => {
    const parsed = makeParsed({
      type: "wget-download",
      url: "https://example.com/page.html",
      destination: "file.html",
      raw: "wget -O file.html https://example.com/page.html",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toContain("/home/user/sandbox/file.html");
    expect(result.newPath).toBe("/home/user/sandbox/file.html");
  });

  test("-O inside sandbox is unchanged", () => {
    const parsed = makeParsed({
      type: "wget-download",
      url: "https://example.com/page.html",
      destination: "/home/user/sandbox/page.html",
      raw: "wget -O /home/user/sandbox/page.html https://example.com/page.html",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe(parsed.raw);
  });
});

// ============================================================
// rewriteCommand — wget-dir
// ============================================================

describe("rewriteCommand — wget-dir", () => {
  test("-P outside sandbox rewrites to sandbox", () => {
    const parsed = makeParsed({
      type: "wget-dir",
      url: "https://example.com/page.html",
      destination: "/tmp/downloads",
      raw: "wget -P /tmp/downloads https://example.com/page.html",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toContain(SANDBOX);
    expect(result.newPath).toBe(SANDBOX);
  });

  test("-P inside sandbox is unchanged", () => {
    const parsed = makeParsed({
      type: "wget-dir",
      url: "https://example.com/page.html",
      destination: "/home/user/sandbox",
      raw: "wget -P /home/user/sandbox https://example.com/page.html",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe(parsed.raw);
  });
});

// ============================================================
// rewriteCommand — passthrough
// ============================================================

describe("rewriteCommand — passthrough", () => {
  test("passthrough returns unchanged", () => {
    const parsed = makeParsed({
      type: "passthrough",
      raw: "echo hello world",
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe("echo hello world");
    expect(result.original).toBe("echo hello world");
    expect(result.newPath).toBe(null);
  });
});

// ============================================================
// buildHookOutput
// ============================================================

describe("buildHookOutput", () => {
  test("not changed returns null", () => {
    const result = buildHookOutput(
      {
        rewritten: "git clone repo",
        original: "git clone repo",
        changed: false,
        newPath: null,
      },
      "rewrite"
    );
    expect(result).toBeNull();
  });

  test("changed + rewrite mode returns hookSpecificOutput with allow", () => {
    const result = buildHookOutput(
      {
        rewritten: "git clone repo /home/user/sandbox/repo",
        original: "git clone repo",
        changed: true,
        newPath: "/home/user/sandbox/repo",
      },
      "rewrite"
    );
    expect(result).not.toBeNull();
    expect(result!.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(result!.hookSpecificOutput.updatedInput).toEqual({
      command: "git clone repo /home/user/sandbox/repo",
    });
    expect(result!.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  test("changed + block mode returns hookSpecificOutput with deny", () => {
    const result = buildHookOutput(
      {
        rewritten: "git clone repo",
        original: "git clone repo",
        changed: true,
        newPath: null,
      },
      "block"
    );
    expect(result).not.toBeNull();
    expect(result!.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(result!.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result!.hookSpecificOutput.updatedInput).toBeUndefined();
  });
});

// ============================================================
// Path-traversal bypass in rewriter — security regression
//
// Same defect class as SF-001 in hooks/ContentFilter.hook.ts:
// raw `String.startsWith(sandboxDir)` was used to short-circuit the
// rewrite when the destination/output/dir target was "already inside
// sandbox." That short-circuit fired on two unintended path classes:
//   - `..` traversal — `${sandbox}/../etc` literally starts with
//     `${sandbox}` so the rewriter would skip rewriting and pass the
//     `..` through to the OS.
//   - sibling-directory prefix — `${sandbox}-evil` matches the
//     leading characters.
// Both close with the same path.resolve + path.sep boundary check
// (now `isInsideSandbox` helper inside sandbox-rewriter.ts).
// ============================================================

describe("sandbox-rewriter — path-traversal bypass (SF-001 follow-up)", () => {
  test("rewriteCommand: clone destination with `..` traversal is REWRITTEN, not passed through", () => {
    const traversalDest = `${SANDBOX}/../etc/poison`;
    const parsed = makeParsed({
      type: "git-clone",
      raw: `git clone https://github.com/owner/repo.git ${traversalDest}`,
      url: "https://github.com/owner/repo.git",
      destination: traversalDest,
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    // If the bypass were unfixed, `traversalDest.startsWith(SANDBOX)` would be true
    // and the rewriter would treat it as already-in-sandbox (no rewrite).
    // With the fix, the rewriter recognises it's outside and rewrites.
    expect(result.changed).toBe(true);
    expect(result.newPath).not.toBeNull();
    // The new path must be canonically inside the sandbox.
    expect(result.newPath!.startsWith(SANDBOX + "/")).toBe(true);
    expect(result.newPath!.includes("..")).toBe(false);
  });

  test("rewriteCommand: sibling-directory prefix is REWRITTEN, not passed through", () => {
    const siblingDest = `${SANDBOX}-evil/poison`;
    const parsed = makeParsed({
      type: "git-clone",
      raw: `git clone https://github.com/owner/repo.git ${siblingDest}`,
      url: "https://github.com/owner/repo.git",
      destination: siblingDest,
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(true);
    expect(result.newPath).not.toBeNull();
    expect(result.newPath!.startsWith(SANDBOX + "/")).toBe(true);
  });

  test("rewriteCommand: legitimate inside-sandbox destination is NOT rewritten", () => {
    // Control: confirm the fix didn't break the happy path.
    const insideDest = `${SANDBOX}/legit-clone`;
    const parsed = makeParsed({
      type: "git-clone",
      raw: `git clone https://github.com/owner/repo.git ${insideDest}`,
      url: "https://github.com/owner/repo.git",
      destination: insideDest,
    });
    const result = rewriteCommand(parsed, SANDBOX, "rewrite");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe(parsed.raw);
  });
});
