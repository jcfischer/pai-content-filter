import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "path";
import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import {
  logAuditEntry,
  readAuditLog,
  buildAuditConfig,
  createAuditEntry,
  hashContent,
  generateSessionId,
  currentLogName,
  rotateIfNeeded,
} from "../src/lib/audit";
import type { AuditEntry, FilterResult } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TMP_BASE = `/private/tmp/claude-503/-Users-fischer-work-kai-improvement-roadmap/e1f0418f-93bc-4ed1-9934-44d7884f405a/scratchpad/audit-test-${Date.now()}`;

/** Track all dirs created so afterAll can clean the root. */
const createdDirs: string[] = [];

function freshDir(label: string): string {
  const dir = join(TMP_BASE, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

const mockResult: FilterResult = {
  decision: "BLOCKED",
  matches: [
    {
      pattern_id: "PI-001",
      pattern_name: "test",
      category: "injection",
      severity: "block",
      matched_text: "test",
      line: 1,
      column: 1,
    },
  ],
  encodings: [],
  schema_valid: true,
  file: "test.md",
  format: "markdown",
};

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    session_id: generateSessionId(),
    event_type: "filter_block",
    source_repo: "",
    source_file: "test.md",
    content_hash: hashContent("test-content"),
    decision: "BLOCKED",
    matched_patterns: ["PI-001"],
    encoding_detections: [],
    schema_valid: true,
    format: "markdown",
    ...overrides,
  };
}

afterAll(() => {
  try {
    rmSync(TMP_BASE, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ============================================================
// hashContent
// ============================================================

describe("hashContent", () => {
  test("produces consistent SHA-256 for same input", () => {
    const h1 = hashContent("hello world");
    const h2 = hashContent("hello world");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("produces different hashes for different inputs", () => {
    const h1 = hashContent("input-one");
    const h2 = hashContent("input-two");
    expect(h1).not.toBe(h2);
  });
});

// ============================================================
// generateSessionId
// ============================================================

describe("generateSessionId", () => {
  test("returns UUID v4 format", () => {
    const id = generateSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("generates unique values on each call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSessionId()));
    expect(ids.size).toBe(50);
  });
});

// ============================================================
// currentLogName
// ============================================================

describe("currentLogName", () => {
  test("returns audit-YYYY-MM.jsonl format", () => {
    const name = currentLogName();
    expect(name).toMatch(/^audit-\d{4}-\d{2}\.jsonl$/);
  });

  test("matches current year and month", () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    expect(currentLogName()).toBe(`audit-${yyyy}-${mm}.jsonl`);
  });
});

// ============================================================
// createAuditEntry
// ============================================================

describe("createAuditEntry", () => {
  test("builds correct entry from FilterResult", () => {
    const hash = hashContent("some content");
    const sid = generateSessionId();
    const entry = createAuditEntry(mockResult, {
      contentHash: hash,
      sessionId: sid,
    });

    expect(entry.session_id).toBe(sid);
    expect(entry.content_hash).toBe(hash);
    expect(entry.decision).toBe("BLOCKED");
    expect(entry.event_type).toBe("filter_block");
    expect(entry.source_file).toBe("test.md");
    expect(entry.matched_patterns).toEqual(["PI-001"]);
    expect(entry.encoding_detections).toEqual([]);
    expect(entry.schema_valid).toBe(true);
    expect(entry.format).toBe("markdown");
    expect(entry.timestamp).toBeTruthy();
  });

  test("applies eventTypeOverride and decisionOverride", () => {
    const entry = createAuditEntry(mockResult, {
      contentHash: hashContent("x"),
      sessionId: generateSessionId(),
      eventTypeOverride: "override",
      decisionOverride: "OVERRIDE",
      approver: "admin",
      reason: "approved",
    });

    expect(entry.event_type).toBe("override");
    expect(entry.decision).toBe("OVERRIDE");
    expect(entry.approver).toBe("admin");
    expect(entry.reason).toBe("approved");
  });
});

// ============================================================
// logAuditEntry
// ============================================================

describe("logAuditEntry", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = freshDir("logAuditEntry");
  });

  test("creates audit dir if missing", () => {
    const nestedDir = join(tempDir, "nested", "audit");
    const config = buildAuditConfig(nestedDir);
    const entry = makeEntry();

    logAuditEntry(entry, config);

    expect(existsSync(nestedDir)).toBe(true);
    const logPath = join(nestedDir, currentLogName());
    expect(existsSync(logPath)).toBe(true);
  });

  test("appends valid JSONL (each line parses to JSON)", () => {
    const config = buildAuditConfig(tempDir);
    const entry = makeEntry();

    logAuditEntry(entry, config);

    const logPath = join(tempDir, currentLogName());
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.decision).toBe("BLOCKED");
  });

  test("multiple entries on separate lines", () => {
    const config = buildAuditConfig(tempDir);

    logAuditEntry(makeEntry({ session_id: "aaa" }), config);
    logAuditEntry(makeEntry({ session_id: "bbb" }), config);
    logAuditEntry(makeEntry({ session_id: "ccc" }), config);

    const logPath = join(tempDir, currentLogName());
    const lines = readFileSync(logPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");

    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("handles write to nonexistent deeply nested dir", () => {
    const deep = join(tempDir, "a", "b", "c", "d", "audit-logs");
    const config = buildAuditConfig(deep);
    const entry = makeEntry();

    // Should not throw -- fail-open semantics
    expect(() => logAuditEntry(entry, config)).not.toThrow();
    expect(existsSync(deep)).toBe(true);
  });
});

// ============================================================
// rotateIfNeeded
// ============================================================

describe("rotateIfNeeded", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = freshDir("rotateIfNeeded");
  });

  test("does nothing when file is small", () => {
    const config = buildAuditConfig(tempDir, { maxSizeBytes: 100 });
    const logPath = join(tempDir, currentLogName());
    writeFileSync(logPath, "short\n");

    rotateIfNeeded(config);

    // File still there, no rotation happened
    expect(existsSync(logPath)).toBe(true);
    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");
    expect(existsSync(join(tempDir, `${prefix}.1.jsonl`))).toBe(false);
  });

  test("rotates when file exceeds maxSizeBytes", () => {
    const config = buildAuditConfig(tempDir, {
      maxSizeBytes: 100,
      maxRotatedFiles: 3,
    });
    const logPath = join(tempDir, currentLogName());
    writeFileSync(logPath, "x".repeat(200) + "\n");

    rotateIfNeeded(config);

    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");

    // Original moved to .1
    expect(existsSync(join(tempDir, `${prefix}.1.jsonl`))).toBe(true);
    // Current file no longer exists (it was renamed)
    expect(existsSync(logPath)).toBe(false);
  });

  test("shifts .1 to .2 and .2 to .3", () => {
    const config = buildAuditConfig(tempDir, {
      maxSizeBytes: 100,
      maxRotatedFiles: 3,
    });
    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");

    // Seed existing rotated files
    writeFileSync(join(tempDir, `${prefix}.1.jsonl`), "rotated-1\n");
    writeFileSync(join(tempDir, `${prefix}.2.jsonl`), "rotated-2\n");
    // Oversized current file
    writeFileSync(join(tempDir, baseName), "x".repeat(200) + "\n");

    rotateIfNeeded(config);

    // .2 content should now be in .3
    expect(readFileSync(join(tempDir, `${prefix}.3.jsonl`), "utf-8")).toContain(
      "rotated-2"
    );
    // .1 content should now be in .2
    expect(readFileSync(join(tempDir, `${prefix}.2.jsonl`), "utf-8")).toContain(
      "rotated-1"
    );
    // Current should now be in .1
    expect(
      readFileSync(join(tempDir, `${prefix}.1.jsonl`), "utf-8").length
    ).toBeGreaterThan(100);
  });

  test("deletes beyond maxRotatedFiles", () => {
    const config = buildAuditConfig(tempDir, {
      maxSizeBytes: 100,
      maxRotatedFiles: 2,
    });
    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");

    // Seed existing rotated files up to limit
    writeFileSync(join(tempDir, `${prefix}.1.jsonl`), "rotated-1\n");
    writeFileSync(join(tempDir, `${prefix}.2.jsonl`), "should-be-deleted\n");
    // Oversized current file
    writeFileSync(join(tempDir, baseName), "x".repeat(200) + "\n");

    rotateIfNeeded(config);

    // .2 was at the max, so the old .2 should have been removed (or overwritten)
    // After rotation: current -> .1, old .1 -> .2, old .2 deleted
    expect(existsSync(join(tempDir, `${prefix}.1.jsonl`))).toBe(true);
    expect(existsSync(join(tempDir, `${prefix}.2.jsonl`))).toBe(true);
    // The content of .2 should be old .1 content, not "should-be-deleted"
    expect(readFileSync(join(tempDir, `${prefix}.2.jsonl`), "utf-8")).toContain(
      "rotated-1"
    );
  });

  test("creates rotation chain correctly", () => {
    const config = buildAuditConfig(tempDir, {
      maxSizeBytes: 100,
      maxRotatedFiles: 3,
    });
    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");
    const logPath = join(tempDir, baseName);

    // First rotation
    writeFileSync(logPath, "generation-1-" + "x".repeat(200) + "\n");
    rotateIfNeeded(config);
    expect(existsSync(join(tempDir, `${prefix}.1.jsonl`))).toBe(true);
    expect(
      readFileSync(join(tempDir, `${prefix}.1.jsonl`), "utf-8")
    ).toContain("generation-1");

    // Second rotation
    writeFileSync(logPath, "generation-2-" + "y".repeat(200) + "\n");
    rotateIfNeeded(config);
    expect(
      readFileSync(join(tempDir, `${prefix}.1.jsonl`), "utf-8")
    ).toContain("generation-2");
    expect(
      readFileSync(join(tempDir, `${prefix}.2.jsonl`), "utf-8")
    ).toContain("generation-1");

    // Third rotation
    writeFileSync(logPath, "generation-3-" + "z".repeat(200) + "\n");
    rotateIfNeeded(config);
    expect(
      readFileSync(join(tempDir, `${prefix}.1.jsonl`), "utf-8")
    ).toContain("generation-3");
    expect(
      readFileSync(join(tempDir, `${prefix}.2.jsonl`), "utf-8")
    ).toContain("generation-2");
    expect(
      readFileSync(join(tempDir, `${prefix}.3.jsonl`), "utf-8")
    ).toContain("generation-1");
  });
});

// ============================================================
// readAuditLog
// ============================================================

describe("readAuditLog", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = freshDir("readAuditLog");
  });

  test("returns empty array for missing dir", () => {
    const config = buildAuditConfig(join(tempDir, "nonexistent"));
    const entries = readAuditLog(config);
    expect(entries).toEqual([]);
  });

  test("returns entries in reverse chronological order", () => {
    const config = buildAuditConfig(tempDir);
    const logPath = join(tempDir, currentLogName());

    const e1 = makeEntry({
      timestamp: "2026-01-01T00:00:00.000Z",
      session_id: "oldest",
    });
    const e2 = makeEntry({
      timestamp: "2026-01-15T00:00:00.000Z",
      session_id: "middle",
    });
    const e3 = makeEntry({
      timestamp: "2026-01-31T00:00:00.000Z",
      session_id: "newest",
    });

    // Write in ascending order
    writeFileSync(
      logPath,
      [JSON.stringify(e1), JSON.stringify(e2), JSON.stringify(e3)].join("\n") +
        "\n"
    );

    const results = readAuditLog(config);
    expect(results.length).toBe(3);
    expect(results[0]!.session_id).toBe("newest");
    expect(results[1]!.session_id).toBe("middle");
    expect(results[2]!.session_id).toBe("oldest");
  });

  test("filters by decision", () => {
    const config = buildAuditConfig(tempDir);
    const logPath = join(tempDir, currentLogName());

    const blocked = makeEntry({ decision: "BLOCKED", session_id: "b" });
    const allowed = makeEntry({
      decision: "ALLOWED",
      event_type: "filter_pass",
      session_id: "a",
    });

    writeFileSync(
      logPath,
      [JSON.stringify(blocked), JSON.stringify(allowed)].join("\n") + "\n"
    );

    const results = readAuditLog(config, { decision: "BLOCKED" });
    expect(results.length).toBe(1);
    expect(results[0]!.decision).toBe("BLOCKED");
  });

  test("filters by eventType", () => {
    const config = buildAuditConfig(tempDir);
    const logPath = join(tempDir, currentLogName());

    const block = makeEntry({ event_type: "filter_block", session_id: "fb" });
    const override = makeEntry({
      event_type: "override",
      decision: "OVERRIDE",
      session_id: "ov",
    });

    writeFileSync(
      logPath,
      [JSON.stringify(block), JSON.stringify(override)].join("\n") + "\n"
    );

    const results = readAuditLog(config, { eventType: "override" });
    expect(results.length).toBe(1);
    expect(results[0]!.event_type).toBe("override");
  });

  test("respects --last N limit", () => {
    const config = buildAuditConfig(tempDir);
    const logPath = join(tempDir, currentLogName());

    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        session_id: `entry-${i}`,
      })
    );

    writeFileSync(
      logPath,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );

    const results = readAuditLog(config, { last: 3 });
    expect(results.length).toBe(3);
    // Should be the 3 newest
    expect(results[0]!.session_id).toBe("entry-9");
    expect(results[1]!.session_id).toBe("entry-8");
    expect(results[2]!.session_id).toBe("entry-7");
  });

  test("skips malformed JSONL lines", () => {
    const config = buildAuditConfig(tempDir);
    const logPath = join(tempDir, currentLogName());

    const good = makeEntry({ session_id: "valid-one" });

    writeFileSync(
      logPath,
      [
        JSON.stringify(good),
        "NOT VALID JSON AT ALL",
        '{"partial": true}',
        JSON.stringify(makeEntry({ session_id: "valid-two" })),
      ].join("\n") + "\n"
    );

    const results = readAuditLog(config);
    expect(results.length).toBe(2);
    const ids = results.map((e) => e.session_id);
    expect(ids).toContain("valid-one");
    expect(ids).toContain("valid-two");
  });

  test("reads across rotated files", () => {
    const config = buildAuditConfig(tempDir, { maxRotatedFiles: 3 });
    const baseName = currentLogName();
    const prefix = baseName.replace(".jsonl", "");

    const current = makeEntry({
      timestamp: "2026-01-31T00:00:00.000Z",
      session_id: "current",
    });
    const rotated1 = makeEntry({
      timestamp: "2026-01-20T00:00:00.000Z",
      session_id: "rotated-1",
    });
    const rotated2 = makeEntry({
      timestamp: "2026-01-10T00:00:00.000Z",
      session_id: "rotated-2",
    });

    writeFileSync(join(tempDir, baseName), JSON.stringify(current) + "\n");
    writeFileSync(
      join(tempDir, `${prefix}.1.jsonl`),
      JSON.stringify(rotated1) + "\n"
    );
    writeFileSync(
      join(tempDir, `${prefix}.2.jsonl`),
      JSON.stringify(rotated2) + "\n"
    );

    const results = readAuditLog(config);
    expect(results.length).toBe(3);
    // Newest first
    expect(results[0]!.session_id).toBe("current");
    expect(results[1]!.session_id).toBe("rotated-1");
    expect(results[2]!.session_id).toBe("rotated-2");
  });
});
