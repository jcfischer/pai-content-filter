import { describe, expect, test } from "bun:test";
import {
  extractFirstCommand,
  tokenize,
  classifyCommand,
} from "../src/lib/command-parser";
// ============================================================
// extractFirstCommand
// ============================================================

describe("extractFirstCommand", () => {
  test("single command — no splitting needed", () => {
    expect(extractFirstCommand("git clone url")).toBe("git clone url");
  });

  test("&& chain — returns first segment", () => {
    expect(extractFirstCommand("git clone url && cd dir")).toBe(
      "git clone url",
    );
  });

  test("|| chain — returns first segment", () => {
    expect(extractFirstCommand("cmd1 || cmd2")).toBe("cmd1");
  });

  test("; chain — returns first segment", () => {
    expect(extractFirstCommand("cmd1 ; cmd2")).toBe("cmd1");
  });

  test("empty string — returns empty", () => {
    expect(extractFirstCommand("")).toBe("");
  });

  test("whitespace only — returns empty", () => {
    expect(extractFirstCommand("  ")).toBe("");
  });

  test("multiple separators — returns first segment before earliest separator", () => {
    expect(extractFirstCommand("a && b || c")).toBe("a");
  });
});

// ============================================================
// tokenize
// ============================================================

describe("tokenize", () => {
  test("normal spacing", () => {
    expect(tokenize("git clone url")).toEqual(["git", "clone", "url"]);
  });

  test("multiple spaces between tokens", () => {
    expect(tokenize("git  clone   url")).toEqual(["git", "clone", "url"]);
  });

  test("empty string — returns empty array", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// ============================================================
// classifyCommand — git clone
// ============================================================

describe("classifyCommand — git clone", () => {
  test("basic git clone with URL", () => {
    const result = classifyCommand([
      "git",
      "clone",
      "https://github.com/owner/repo.git",
    ]);
    expect(result.type).toBe("git-clone");
    expect(result.url).toBe("https://github.com/owner/repo.git");
    expect(result.destination).toBeNull();
  });

  test("git clone with URL and destination", () => {
    const result = classifyCommand([
      "git",
      "clone",
      "https://github.com/owner/repo.git",
      "/tmp/repo",
    ]);
    expect(result.type).toBe("git-clone");
    expect(result.url).toBe("https://github.com/owner/repo.git");
    expect(result.destination).toBe("/tmp/repo");
  });

  test("git clone with --depth value flag — URL not misclassified as value", () => {
    const result = classifyCommand([
      "git",
      "clone",
      "--depth",
      "1",
      "https://github.com/owner/repo.git",
    ]);
    expect(result.type).toBe("git-clone");
    expect(result.url).toBe("https://github.com/owner/repo.git");
    expect(result.flags).toContain("--depth");
    expect(result.flags).toContain("1");
  });

  test("git clone with multiple value flags — URL still correct", () => {
    const result = classifyCommand([
      "git",
      "clone",
      "--branch",
      "main",
      "--depth",
      "1",
      "https://github.com/owner/repo.git",
    ]);
    expect(result.type).toBe("git-clone");
    expect(result.url).toBe("https://github.com/owner/repo.git");
    expect(result.flags).toContain("--branch");
    expect(result.flags).toContain("main");
    expect(result.flags).toContain("--depth");
    expect(result.flags).toContain("1");
  });

  test("git clone with dot destination", () => {
    const result = classifyCommand([
      "git",
      "clone",
      "https://github.com/owner/repo.git",
      ".",
    ]);
    expect(result.type).toBe("git-clone");
    expect(result.url).toBe("https://github.com/owner/repo.git");
    expect(result.destination).toBe(".");
  });
});

// ============================================================
// classifyCommand — gh repo clone
// ============================================================

describe("classifyCommand — gh repo clone", () => {
  test("basic gh repo clone", () => {
    const result = classifyCommand(["gh", "repo", "clone", "owner/repo"]);
    expect(result.type).toBe("gh-clone");
    expect(result.url).toBe("owner/repo");
    expect(result.destination).toBeNull();
  });

  test("gh repo clone with destination", () => {
    const result = classifyCommand([
      "gh",
      "repo",
      "clone",
      "owner/repo",
      "/tmp/dest",
    ]);
    expect(result.type).toBe("gh-clone");
    expect(result.url).toBe("owner/repo");
    expect(result.destination).toBe("/tmp/dest");
  });
});

// ============================================================
// classifyCommand — curl
// ============================================================

describe("classifyCommand — curl", () => {
  test("curl with -o before URL — download type", () => {
    const result = classifyCommand([
      "curl",
      "-o",
      "file.json",
      "https://api.example.com/data",
    ]);
    expect(result.type).toBe("curl-download");
    expect(result.url).toBe("https://api.example.com/data");
    expect(result.destination).toBe("file.json");
  });

  test("curl with -o after URL — download type regardless of order", () => {
    const result = classifyCommand([
      "curl",
      "https://api.example.com/data",
      "-o",
      "file.json",
    ]);
    expect(result.type).toBe("curl-download");
    expect(result.url).toBe("https://api.example.com/data");
    expect(result.destination).toBe("file.json");
  });

  test("curl with -L boolean flag and -o — flags preserved", () => {
    const result = classifyCommand([
      "curl",
      "-L",
      "-o",
      "file.json",
      "https://api.example.com/data",
    ]);
    expect(result.type).toBe("curl-download");
    expect(result.url).toBe("https://api.example.com/data");
    expect(result.destination).toBe("file.json");
    expect(result.flags).toContain("-L");
  });

  test("curl without -o — passthrough (stdout output)", () => {
    const result = classifyCommand([
      "curl",
      "https://api.example.com/data",
    ]);
    expect(result.type).toBe("passthrough");
  });

  test("curl with -H consuming next token — destination still correct", () => {
    const result = classifyCommand([
      "curl",
      "-H",
      "Auth: Bearer xxx",
      "-o",
      "out.json",
      "https://api.example.com",
    ]);
    expect(result.type).toBe("curl-download");
    expect(result.url).toBe("https://api.example.com");
    expect(result.destination).toBe("out.json");
  });
});

// ============================================================
// classifyCommand — wget
// ============================================================

describe("classifyCommand — wget", () => {
  test("wget with -O — download type", () => {
    const result = classifyCommand([
      "wget",
      "-O",
      "file.html",
      "https://example.com",
    ]);
    expect(result.type).toBe("wget-download");
    expect(result.url).toBe("https://example.com");
    expect(result.destination).toBe("file.html");
  });

  test("wget with -P — directory download type", () => {
    const result = classifyCommand([
      "wget",
      "-P",
      "/tmp/downloads",
      "https://example.com/file",
    ]);
    expect(result.type).toBe("wget-dir");
    expect(result.url).toBe("https://example.com/file");
    expect(result.destination).toBe("/tmp/downloads");
  });

  test("wget without -O or -P — passthrough", () => {
    const result = classifyCommand(["wget", "https://example.com/file"]);
    expect(result.type).toBe("passthrough");
  });
});

// ============================================================
// classifyCommand — passthrough (non-download commands)
// ============================================================

describe("classifyCommand — passthrough", () => {
  test("git commit", () => {
    expect(
      classifyCommand(["git", "commit", "-m", "msg"]).type,
    ).toBe("passthrough");
  });

  test("git push", () => {
    expect(classifyCommand(["git", "push"]).type).toBe("passthrough");
  });

  test("git pull", () => {
    expect(classifyCommand(["git", "pull"]).type).toBe("passthrough");
  });

  test("git branch", () => {
    expect(classifyCommand(["git", "branch"]).type).toBe("passthrough");
  });

  test("git diff", () => {
    expect(classifyCommand(["git", "diff"]).type).toBe("passthrough");
  });

  test("git log", () => {
    expect(classifyCommand(["git", "log"]).type).toBe("passthrough");
  });

  test("git status", () => {
    expect(classifyCommand(["git", "status"]).type).toBe("passthrough");
  });

  test("ls -la", () => {
    expect(classifyCommand(["ls", "-la"]).type).toBe("passthrough");
  });

  test("npm install", () => {
    expect(classifyCommand(["npm", "install"]).type).toBe("passthrough");
  });

  test("bun test", () => {
    expect(classifyCommand(["bun", "test"]).type).toBe("passthrough");
  });

  test("bun run build", () => {
    expect(classifyCommand(["bun", "run", "build"]).type).toBe("passthrough");
  });

  test("empty tokens array", () => {
    const result = classifyCommand([]);
    expect(result.type).toBe("passthrough");
    expect(result.url).toBeNull();
    expect(result.destination).toBeNull();
    expect(result.flags).toEqual([]);
    expect(result.tokens).toEqual([]);
  });
});
