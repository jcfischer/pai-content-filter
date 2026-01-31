import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve, join } from "path";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "fs";
import {
  runQuarantine,
  loadProfile,
  buildDefaultConfig,
} from "../src/lib/quarantine-runner";
import { CrossProjectProfileSchema } from "../src/lib/types";
import type { QuarantineResult } from "../src/lib/types";

// ============================================================
// Test infrastructure — mock subprocess scripts
// ============================================================

const SCRATCHPAD = `/private/tmp/claude-503/-Users-fischer-work-kai-improvement-roadmap/quarantine-test-${Date.now()}`;
const MOCK_DIR = join(SCRATCHPAD, "mocks");
const PROFILE_PATH = resolve(
  import.meta.dir,
  "../config/cross-project-profile.json"
);

// Valid TypedReference JSON for mock output
const VALID_REF = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  origin: "test/file.yaml",
  trust_level: "untrusted",
  content_hash: "a".repeat(64),
  filter_result: "PASSED",
  consumed_at: "2026-01-31T14:00:00.000Z",
  format: "yaml",
  data: { name: "test-project" },
  source_file: "repos/test/file.yaml",
};

const INVALID_REF = {
  id: "not-a-uuid",
  trust_level: "trusted", // wrong
  // missing most fields
};

function mockScript(name: string, code: string): string {
  const path = join(MOCK_DIR, name);
  writeFileSync(path, `#!/usr/bin/env bun\n${code}`);
  chmodSync(path, 0o755);
  return path;
}

beforeAll(() => {
  mkdirSync(MOCK_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(SCRATCHPAD, { recursive: true, force: true });
});

// ============================================================
// T-4.1: MCP Profile Schema
// ============================================================

describe("CrossProjectProfile", () => {
  test("profile config file exists and parses", () => {
    const raw = readFileSync(PROFILE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const result = CrossProjectProfileSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  test("profile has correct name", () => {
    const profile = loadProfile(PROFILE_PATH);
    expect(profile.name).toBe("cross-project");
  });

  test("profile allows read-only tools", () => {
    const profile = loadProfile(PROFILE_PATH);
    expect(profile.allowedTools).toContain("Read");
    expect(profile.allowedTools).toContain("Glob");
    expect(profile.allowedTools).toContain("Grep");
    expect(profile.allowedTools).toContain("WebFetch");
  });

  test("profile denies write/execute tools", () => {
    const profile = loadProfile(PROFILE_PATH);
    expect(profile.deniedTools).toContain("Bash");
    expect(profile.deniedTools).toContain("Write");
    expect(profile.deniedTools).toContain("Edit");
    expect(profile.deniedTools).toContain("NotebookEdit");
  });

  test("profile denies USER/ path", () => {
    const profile = loadProfile(PROFILE_PATH);
    expect(
      profile.deniedPaths.some((p: string) => p.includes("USER"))
    ).toBe(true);
  });

  test("rejects invalid profile", () => {
    const result = CrossProjectProfileSchema.safeParse({ name: 123 });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// T-4.3: Quarantine Runner — successful execution
// ============================================================

describe("runQuarantine — success", () => {
  test("collects valid TypedReferences from stdout", async () => {
    const script = mockScript(
      "output-refs.ts",
      `console.log(JSON.stringify([${JSON.stringify(VALID_REF)}]));`
    );
    const result = await runQuarantine(["file1.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]!.id).toBe(VALID_REF.id);
  });

  test("returns empty references for empty JSON array", async () => {
    const script = mockScript(
      "empty-output.ts",
      `console.log("[]");`
    );
    const result = await runQuarantine(["file1.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(true);
    expect(result.references).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("returns empty result for no files", async () => {
    const script = mockScript(
      "no-files.ts",
      `console.log("[]");`
    );
    const result = await runQuarantine([], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(true);
    expect(result.references).toHaveLength(0);
    expect(result.filesProcessed).toBe(0);
  });

  test("tracks filesProcessed count", async () => {
    const script = mockScript(
      "count-files.ts",
      `console.log("[]");`
    );
    const result = await runQuarantine(
      ["a.yaml", "b.yaml", "c.yaml"],
      {
        timeoutMs: 5000,
        profilePath: PROFILE_PATH,
        command: script,
      }
    );
    expect(result.filesProcessed).toBe(3);
  });

  test("records durationMs", async () => {
    const script = mockScript(
      "duration.ts",
      `console.log("[]");`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });

  test("exitCode is 0 on success", async () => {
    const script = mockScript(
      "exit-zero.ts",
      `console.log("[]");`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.exitCode).toBe(0);
  });
});

// ============================================================
// T-4.4: Provenance validation gate
// ============================================================

describe("runQuarantine — provenance validation", () => {
  test("rejects references with invalid provenance", async () => {
    const script = mockScript(
      "invalid-refs.ts",
      `console.log(JSON.stringify([${JSON.stringify(INVALID_REF)}]));`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.references).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("handles mixed valid and invalid references", async () => {
    const script = mockScript(
      "mixed-refs.ts",
      `console.log(JSON.stringify([${JSON.stringify(VALID_REF)}, ${JSON.stringify(INVALID_REF)}]));`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.references).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
    // Partial success — has valid refs but also errors
    expect(result.success).toBe(true);
  });

  test("all-invalid references still returns success with errors", async () => {
    const script = mockScript(
      "all-invalid.ts",
      `console.log(JSON.stringify([${JSON.stringify(INVALID_REF)}, ${JSON.stringify(INVALID_REF)}]));`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.references).toHaveLength(0);
    expect(result.errors.length).toBe(2);
    // Process succeeded, but all refs were invalid
    expect(result.success).toBe(true);
  });
});

// ============================================================
// T-4.5: Error handling
// ============================================================

describe("runQuarantine — error handling", () => {
  test("handles non-zero exit code", async () => {
    const script = mockScript(
      "exit-one.ts",
      `process.exit(1);`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("handles malformed stdout (not JSON)", async () => {
    const script = mockScript(
      "garbage.ts",
      `console.log("this is not json");`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(false);
    expect(result.references).toHaveLength(0);
    expect(result.errors.some((e: string) => e.includes("parse"))).toBe(true);
  });

  test("handles stdout that is JSON but not an array", async () => {
    const script = mockScript(
      "json-object.ts",
      `console.log(JSON.stringify({ not: "an array" }));`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e: string) => e.includes("array"))).toBe(true);
  });

  test("handles timeout", async () => {
    const script = mockScript(
      "slow.ts",
      `await Bun.sleep(10000); console.log("[]");`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 500, // 500ms — script sleeps 10s
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e: string) => e.includes("timeout") || e.includes("Timeout"))).toBe(true);
  });

  test("handles stderr output on failure", async () => {
    const script = mockScript(
      "stderr.ts",
      `console.error("something went wrong"); process.exit(2);`
    );
    const result = await runQuarantine(["file.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
  });
});

// ============================================================
// T-4.5 continued: QuarantineResult metadata
// ============================================================

describe("QuarantineResult metadata", () => {
  test("success result has all required fields", async () => {
    const script = mockScript(
      "meta-success.ts",
      `console.log(JSON.stringify([${JSON.stringify(VALID_REF)}]));`
    );
    const result: QuarantineResult = await runQuarantine(["f.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.references)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.filesProcessed).toBe("number");
    expect(result.exitCode === null || typeof result.exitCode === "number").toBe(
      true
    );
  });

  test("error result has all required fields", async () => {
    const script = mockScript(
      "meta-error.ts",
      `process.exit(1);`
    );
    const result: QuarantineResult = await runQuarantine(["f.yaml"], {
      timeoutMs: 5000,
      profilePath: PROFILE_PATH,
      command: script,
    });
    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.references)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.filesProcessed).toBe("number");
  });
});

// ============================================================
// buildDefaultConfig
// ============================================================

describe("buildDefaultConfig", () => {
  test("returns config with defaults", () => {
    const config = buildDefaultConfig(PROFILE_PATH);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.profilePath).toBe(PROFILE_PATH);
    expect(config.command).toBeUndefined();
  });

  test("allows override of timeoutMs", () => {
    const config = buildDefaultConfig(PROFILE_PATH, { timeoutMs: 5000 });
    expect(config.timeoutMs).toBe(5000);
  });
});
