import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const HOOK_PATH = join(
  import.meta.dir,
  "../../hooks/SandboxEnforcer.hook.ts"
);
const SANDBOX = "/home/user/sandbox";

interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runHook(
  stdinData: string,
  env: Record<string, string> = {}
): Promise<HookResult> {
  const proc = Bun.spawn(["bun", "run", HOOK_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CONTENT_FILTER_SANDBOX_DIR: SANDBOX,
      ...env,
    },
  });

  // Write stdin and close
  proc.stdin.write(stdinData);
  proc.stdin.end();

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function makeInput(command: string) {
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });
}

// ============================================================
// Block-and-instruct mode (default) — exit 2 with rewrite instruction
// ============================================================

describe("SandboxEnforcer hook — block-and-instruct", () => {
  test("git clone without destination: exit 2 with sandbox command", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git")
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("[SandboxEnforcer] BLOCKED");
    expect(stderr).toContain("/home/user/sandbox/repo");
    expect(stderr).toContain("Use this command instead:");
  });

  test("git clone with destination outside sandbox: exit 2 with sandbox path", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git /tmp/repo")
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("/home/user/sandbox/repo");
  });

  test("git clone with destination inside sandbox: passthrough", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput(
        "git clone https://github.com/owner/repo.git /home/user/sandbox/repo"
      )
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe(""); // no block needed
  });

  test("curl -o outside sandbox: exit 2 with sandbox path", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("curl -o file.json https://example.com/data.json")
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("/home/user/sandbox/file.json");
    expect(stderr).toContain("Use this command instead:");
  });

  test("chained command: first segment blocked", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput(
        "git clone https://github.com/owner/repo.git && cd repo"
      )
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("/home/user/sandbox/repo");
  });

  test("wget -O outside sandbox: exit 2 with sandbox path", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("wget -O output.html https://example.com/page")
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("/home/user/sandbox/output.html");
  });

  test("wget -P outside sandbox: exit 2 with sandbox path", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("wget -P /tmp/downloads https://example.com/page")
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("[SandboxEnforcer] BLOCKED");
    expect(stderr).toContain("/home/user/sandbox");
  });
});

// ============================================================
// Passthrough commands
// ============================================================

describe("SandboxEnforcer hook — passthrough", () => {
  test("git commit passes through (empty stdout)", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput('git commit -m "message"')
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("git pull passes through", async () => {
    const { stdout, exitCode } = await runHook(makeInput("git pull"));
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("ls passes through", async () => {
    const { stdout, exitCode } = await runHook(makeInput("ls -la"));
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("non-Bash tool passes through", async () => {
    const { stdout, exitCode } = await runHook(
      JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: "/some/file" },
      })
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});

// ============================================================
// Error handling (fail-closed)
// ============================================================

describe("SandboxEnforcer hook — fail-closed", () => {
  test("malformed JSON stdin → exit 2 (fail-closed)", async () => {
    const { exitCode } = await runHook("not json at all");
    expect(exitCode).toBe(2);
  });

  test("empty stdin → exit 2 (fail-closed)", async () => {
    const { exitCode } = await runHook("");
    expect(exitCode).toBe(2);
  });

  test("missing SANDBOX_DIR env → passthrough (not an error)", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git"),
      { CONTENT_FILTER_SANDBOX_DIR: "" }
    );
    // Missing sandbox config is a deliberate operator choice, not an error
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});

// ============================================================
// Block mode (CONTENT_FILTER_ENFORCER_MODE=block)
// ============================================================

describe("SandboxEnforcer hook — block mode", () => {
  test("block mode: exit 2 for command needing redirect", async () => {
    const { stderr, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git"),
      { CONTENT_FILTER_ENFORCER_MODE: "block" }
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("[SandboxEnforcer] BLOCKED");
    expect(stderr).toContain("must target sandbox directory");
  });

  test("block mode passes through commands that don't need rewrite", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput("git commit -m 'msg'"),
      { CONTENT_FILTER_ENFORCER_MODE: "block" }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});
