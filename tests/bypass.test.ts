import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { bypassFilter } from "../src/lib/bypass";
import { buildAuditConfig, currentLogName } from "../src/lib/audit";
import type { FilterResult } from "../src/lib/types";

const TMP_BASE = `/private/tmp/claude-503/bypass-test-${Date.now()}`;
const createdDirs: string[] = [];

function freshDir(label: string): string {
  const dir = join(
    TMP_BASE,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

afterAll(() => {
  try {
    rmSync(TMP_BASE, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

const blockedResult: FilterResult = {
  decision: "BLOCKED",
  matches: [
    {
      pattern_id: "PI-001",
      pattern_name: "system prompt override",
      category: "injection",
      severity: "block",
      matched_text: "ignore previous",
      line: 1,
      column: 1,
    },
  ],
  encodings: [],
  schema_valid: true,
  file: "test.yaml",
  format: "yaml",
};

// ============================================================
// bypassFilter — validation
// ============================================================

describe("bypassFilter — validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = freshDir("bypass-validation");
  });

  test("throws on empty caller_id", () => {
    const config = buildAuditConfig(tempDir);
    expect(() =>
      bypassFilter(blockedResult, "content", "", "reason", config)
    ).toThrow("non-empty caller_id");
  });

  test("throws on whitespace-only caller_id", () => {
    const config = buildAuditConfig(tempDir);
    expect(() =>
      bypassFilter(blockedResult, "content", "   ", "reason", config)
    ).toThrow("non-empty caller_id");
  });

  test("throws on empty reason", () => {
    const config = buildAuditConfig(tempDir);
    expect(() =>
      bypassFilter(blockedResult, "content", "caller", "", config)
    ).toThrow("non-empty reason");
  });

  test("throws on whitespace-only reason", () => {
    const config = buildAuditConfig(tempDir);
    expect(() =>
      bypassFilter(blockedResult, "content", "caller", "  ", config)
    ).toThrow("non-empty reason");
  });
});

// ============================================================
// bypassFilter — behavior
// ============================================================

describe("bypassFilter — behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = freshDir("bypass-behavior");
  });

  test("changes decision from BLOCKED to ALLOWED", () => {
    const config = buildAuditConfig(tempDir);
    const { result } = bypassFilter(
      blockedResult,
      "some content",
      "ivy-heartbeat",
      "False positive on known-safe contributor",
      config
    );
    expect(result.decision).toBe("ALLOWED");
  });

  test("preserves original matches in result", () => {
    const config = buildAuditConfig(tempDir);
    const { result } = bypassFilter(
      blockedResult,
      "some content",
      "ivy-heartbeat",
      "Known safe",
      config
    );
    expect(result.matches).toEqual(blockedResult.matches);
  });

  test("returns bypass event with correct structure", () => {
    const config = buildAuditConfig(tempDir);
    const { bypassEvent } = bypassFilter(
      blockedResult,
      "some content",
      "ivy-heartbeat",
      "False positive",
      config
    );

    expect(bypassEvent.event_type).toBe("content_filter_bypass");
    expect(bypassEvent.caller_id).toBe("ivy-heartbeat");
    expect(bypassEvent.reason).toBe("False positive");
    expect(bypassEvent.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bypassEvent.timestamp).toBeTruthy();
  });

  test("trims caller_id and reason", () => {
    const config = buildAuditConfig(tempDir);
    const { bypassEvent } = bypassFilter(
      blockedResult,
      "content",
      "  ivy-heartbeat  ",
      "  False positive  ",
      config
    );

    expect(bypassEvent.caller_id).toBe("ivy-heartbeat");
    expect(bypassEvent.reason).toBe("False positive");
  });

  test("logs audit entry to disk", () => {
    const config = buildAuditConfig(tempDir);
    bypassFilter(
      blockedResult,
      "some content",
      "ivy-heartbeat",
      "Known safe contributor",
      config
    );

    const logPath = join(tempDir, currentLogName());
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event_type).toBe("content_filter_bypass");
    expect(entry.decision).toBe("ALLOWED");
    expect(entry.approver).toBe("ivy-heartbeat");
    expect(entry.reason).toBe("Known safe contributor");
  });

  test("works with HUMAN_REVIEW results too", () => {
    const config = buildAuditConfig(tempDir);
    const reviewResult: FilterResult = {
      decision: "HUMAN_REVIEW",
      matches: [],
      encodings: [],
      schema_valid: true,
      file: "test.md",
      format: "markdown",
    };

    const { result } = bypassFilter(
      reviewResult,
      "some markdown",
      "ci-pipeline",
      "Automated pipeline bypass for known format",
      config
    );
    expect(result.decision).toBe("ALLOWED");
  });

  test("content hash is deterministic for same content", () => {
    const config = buildAuditConfig(tempDir);
    const content = "deterministic content test";

    const { bypassEvent: e1 } = bypassFilter(
      blockedResult,
      content,
      "caller-1",
      "reason-1",
      config
    );
    const { bypassEvent: e2 } = bypassFilter(
      blockedResult,
      content,
      "caller-2",
      "reason-2",
      config
    );

    expect(e1.content_hash).toBe(e2.content_hash);
  });
});

// ============================================================
// filterContentString — fail-closed
// ============================================================

describe("filterContentString — fail-closed on errors", () => {
  test("returns BLOCKED when config path is invalid", () => {
    const { filterContentString } = require("../src/lib/content-filter");
    const result = filterContentString(
      "clean content",
      "test.yaml",
      "yaml",
      "/nonexistent/path/to/config.yaml"
    );
    expect(result.decision).toBe("BLOCKED");
  });
});
