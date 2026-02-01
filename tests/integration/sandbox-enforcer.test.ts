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
// Rewrite mode (default)
// ============================================================

describe("SandboxEnforcer hook — rewrite mode", () => {
  test("git clone without destination appends sandbox path", async () => {
    const { stdout, stderr, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git")
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.updatedInput.command).toContain("/home/user/sandbox/repo");
    expect(output.permissionDecision).toBe("allow");
    expect(stderr).toContain("[SandboxEnforcer]");
  });

  test("git clone with destination outside sandbox rewrites", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git /tmp/repo")
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.updatedInput.command).toContain("/home/user/sandbox/repo");
    expect(output.permissionDecision).toBe("allow");
  });

  test("git clone with destination inside sandbox passes through", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput(
        "git clone https://github.com/owner/repo.git /home/user/sandbox/repo"
      )
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe(""); // no rewrite needed
  });

  test("curl -o outside sandbox rewrites output path", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput("curl -o file.json https://example.com/data.json")
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.updatedInput.command).toContain(
      "/home/user/sandbox/file.json"
    );
    expect(output.permissionDecision).toBe("allow");
  });

  test("chained command: first segment rewritten", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput(
        "git clone https://github.com/owner/repo.git && cd repo"
      )
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.updatedInput.command).toContain("/home/user/sandbox/repo");
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
// Error handling (fail-open)
// ============================================================

describe("SandboxEnforcer hook — fail-open", () => {
  test("malformed JSON stdin → exit 0, empty stdout", async () => {
    const { stdout, exitCode } = await runHook("not json at all");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("empty stdin → exit 0", async () => {
    const { stdout, exitCode } = await runHook("");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  test("missing SANDBOX_DIR env → passthrough", async () => {
    const { stdout, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git"),
      { CONTENT_FILTER_SANDBOX_DIR: "" }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});

// ============================================================
// Block mode
// ============================================================

describe("SandboxEnforcer hook — block mode", () => {
  test("block mode denies command that needs rewrite", async () => {
    const { stdout, stderr, exitCode } = await runHook(
      makeInput("git clone https://github.com/owner/repo.git"),
      { CONTENT_FILTER_ENFORCER_MODE: "block" }
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.permissionDecision).toBe("deny");
    expect(output.updatedInput).toBeUndefined();
    expect(stderr).toContain("[SandboxEnforcer]");
    expect(stderr).toContain("BLOCKED");
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
