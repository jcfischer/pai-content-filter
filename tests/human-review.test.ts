import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { overrideDecision, submitReview } from "../src/lib/human-review";
import { buildAuditConfig, readAuditLog } from "../src/lib/audit";
import type { AuditConfig, FilterResult } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TMP_BASE = `/private/tmp/claude-503/-Users-fischer-work-kai-improvement-roadmap/e1f0418f-93bc-4ed1-9934-44d7884f405a/scratchpad/hr-test-${Date.now()}`;

const createdDirs: string[] = [];

function freshDir(label: string): string {
  const dir = join(TMP_BASE, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

function blockedResult(): FilterResult {
  return {
    decision: "BLOCKED",
    matches: [
      {
        pattern_id: "PI-001",
        pattern_name: "test-pattern",
        category: "injection",
        severity: "block",
        matched_text: "ignore previous",
        line: 1,
        column: 1,
      },
    ],
    encodings: [],
    schema_valid: true,
    file: "test.md",
    format: "markdown",
  };
}

function reviewResult(): FilterResult {
  return {
    decision: "HUMAN_REVIEW",
    matches: [],
    encodings: [],
    schema_valid: true,
    file: "review.md",
    format: "markdown",
  };
}

const TEST_CONTENT = "some content that was filtered";

afterAll(() => {
  try {
    rmSync(TMP_BASE, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ============================================================
// overrideDecision
// ============================================================

describe("overrideDecision", () => {
  let tempDir: string;
  let config: AuditConfig;

  beforeEach(() => {
    tempDir = freshDir("override");
    config = buildAuditConfig(tempDir);
  });

  test("returns FilterResult with decision OVERRIDE", () => {
    const result = overrideDecision(
      blockedResult(),
      TEST_CONTENT,
      "admin@example.com",
      "False positive confirmed",
      config
    );

    expect(result.decision).toBe("OVERRIDE");
    expect(result.file).toBe("test.md");
    expect(result.matches.length).toBe(1);
  });

  test("throws if result is not BLOCKED", () => {
    const allowed: FilterResult = {
      ...blockedResult(),
      decision: "ALLOWED",
    };

    expect(() =>
      overrideDecision(allowed, TEST_CONTENT, "admin", "reason", config)
    ).toThrow("Cannot override non-BLOCKED content");
  });

  test("throws if approver is empty", () => {
    expect(() =>
      overrideDecision(blockedResult(), TEST_CONTENT, "", "reason", config)
    ).toThrow("non-empty approver");

    expect(() =>
      overrideDecision(blockedResult(), TEST_CONTENT, "   ", "reason", config)
    ).toThrow("non-empty approver");
  });

  test("throws if reason is empty", () => {
    expect(() =>
      overrideDecision(blockedResult(), TEST_CONTENT, "admin", "", config)
    ).toThrow("non-empty reason");

    expect(() =>
      overrideDecision(blockedResult(), TEST_CONTENT, "admin", "   ", config)
    ).toThrow("non-empty reason");
  });

  test("creates audit entry with event_type override", () => {
    overrideDecision(
      blockedResult(),
      TEST_CONTENT,
      "admin@example.com",
      "False positive",
      config
    );

    const entries = readAuditLog(config);
    expect(entries.length).toBe(1);
    expect(entries[0]!.event_type).toBe("override");
  });

  test("audit entry contains approver and reason", () => {
    overrideDecision(
      blockedResult(),
      TEST_CONTENT,
      "security-lead",
      "Reviewed and safe",
      config
    );

    const entries = readAuditLog(config);
    expect(entries.length).toBe(1);
    expect(entries[0]!.approver).toBe("security-lead");
    expect(entries[0]!.reason).toBe("Reviewed and safe");
  });
});

// ============================================================
// submitReview
// ============================================================

describe("submitReview", () => {
  let tempDir: string;
  let config: AuditConfig;

  beforeEach(() => {
    tempDir = freshDir("review");
    config = buildAuditConfig(tempDir);
  });

  test("returns FilterResult with HUMAN_APPROVED decision", () => {
    const result = submitReview(
      reviewResult(),
      TEST_CONTENT,
      "reviewer@example.com",
      "HUMAN_APPROVED",
      config
    );

    expect(result.decision).toBe("HUMAN_APPROVED");
    expect(result.file).toBe("review.md");
  });

  test("returns FilterResult with HUMAN_REJECTED decision", () => {
    const result = submitReview(
      reviewResult(),
      TEST_CONTENT,
      "reviewer@example.com",
      "HUMAN_REJECTED",
      config
    );

    expect(result.decision).toBe("HUMAN_REJECTED");
  });

  test("throws if reviewer is empty", () => {
    expect(() =>
      submitReview(
        reviewResult(),
        TEST_CONTENT,
        "",
        "HUMAN_APPROVED",
        config
      )
    ).toThrow("non-empty reviewer");

    expect(() =>
      submitReview(
        reviewResult(),
        TEST_CONTENT,
        "   ",
        "HUMAN_APPROVED",
        config
      )
    ).toThrow("non-empty reviewer");
  });

  test("creates audit entry with correct event type for approval", () => {
    submitReview(
      reviewResult(),
      TEST_CONTENT,
      "reviewer@example.com",
      "HUMAN_APPROVED",
      config
    );

    const entries = readAuditLog(config);
    expect(entries.length).toBe(1);
    expect(entries[0]!.event_type).toBe("human_approve");
    expect(entries[0]!.decision).toBe("HUMAN_APPROVED");
  });

  test("creates audit entry with correct event type for rejection", () => {
    submitReview(
      reviewResult(),
      TEST_CONTENT,
      "reviewer@example.com",
      "HUMAN_REJECTED",
      config
    );

    const entries = readAuditLog(config);
    expect(entries.length).toBe(1);
    expect(entries[0]!.event_type).toBe("human_reject");
    expect(entries[0]!.decision).toBe("HUMAN_REJECTED");
  });

  test("audit entry contains reviewer identity", () => {
    submitReview(
      reviewResult(),
      TEST_CONTENT,
      "security-analyst",
      "HUMAN_APPROVED",
      config
    );

    const entries = readAuditLog(config);
    expect(entries.length).toBe(1);
    // reviewer is stored in the approver field
    expect(entries[0]!.approver).toBe("security-analyst");
  });
});
