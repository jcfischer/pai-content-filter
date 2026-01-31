import { describe, test, expect } from "bun:test";

// T-3.1: Schema validation — these imports will fail until types exist
import {
  TypedReferenceSchema,
  TypedReferenceFilterResult,
} from "../src/lib/types";

// T-3.2, T-3.3, T-3.4: Builder + validation — will fail until module exists
import {
  createTypedReference,
  validateProvenance,
  extractOrigin,
} from "../src/lib/typed-reference";

import type { FilterResult } from "../src/lib/types";

// ============================================================
// Helpers
// ============================================================

const makeFilterResult = (
  decision: string,
  file = "repos/pai-collab/blackboard/PROJECT.yaml"
): FilterResult => ({
  decision: decision as FilterResult["decision"],
  matches: [],
  encodings: [],
  schema_valid: true,
  file,
  format: "yaml",
});

// ============================================================
// T-3.1: TypedReference Schema
// ============================================================

describe("TypedReferenceSchema", () => {
  test("validates a correct reference", () => {
    const valid = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "pai-collab/blackboard",
      trust_level: "untrusted",
      content_hash: "a".repeat(64),
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: { name: "test" },
      source_file: "repos/pai-collab/blackboard/PROJECT.yaml",
    };
    const result = TypedReferenceSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("rejects missing id", () => {
    const invalid = {
      origin: "pai-collab/blackboard",
      trust_level: "untrusted",
      content_hash: "a".repeat(64),
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = TypedReferenceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects invalid trust_level", () => {
    const invalid = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "test",
      trust_level: "trusted",
      content_hash: "a".repeat(64),
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = TypedReferenceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects invalid filter_result", () => {
    const invalid = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "test",
      trust_level: "untrusted",
      content_hash: "a".repeat(64),
      filter_result: "BLOCKED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = TypedReferenceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("rejects wrong-length content_hash", () => {
    const invalid = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "test",
      trust_level: "untrusted",
      content_hash: "tooshort",
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = TypedReferenceSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("accepts empty data object", () => {
    const valid = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "test",
      trust_level: "untrusted",
      content_hash: "a".repeat(64),
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = TypedReferenceSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("TypedReferenceFilterResult has correct values", () => {
    expect(TypedReferenceFilterResult.options).toContain("PASSED");
    expect(TypedReferenceFilterResult.options).toContain("OVERRIDE");
    expect(TypedReferenceFilterResult.options).toContain("HUMAN_APPROVED");
    expect(TypedReferenceFilterResult.options.length).toBe(3);
  });
});

// ============================================================
// T-3.2: createTypedReference builder
// ============================================================

describe("createTypedReference", () => {
  test("builds valid reference from ALLOWED FilterResult", () => {
    const result = makeFilterResult("ALLOWED");
    const ref = createTypedReference(result, "test content", { name: "test" });
    expect(ref.filter_result).toBe("PASSED");
    expect(ref.trust_level).toBe("untrusted");
    expect(ref.data).toEqual({ name: "test" });
    expect(ref.format).toBe("yaml");
    expect(TypedReferenceSchema.safeParse(ref).success).toBe(true);
  });

  test("builds valid reference from OVERRIDE FilterResult", () => {
    const result = makeFilterResult("OVERRIDE");
    const ref = createTypedReference(result, "content", { key: "val" });
    expect(ref.filter_result).toBe("OVERRIDE");
  });

  test("builds valid reference from HUMAN_APPROVED FilterResult", () => {
    const result = makeFilterResult("HUMAN_APPROVED");
    const ref = createTypedReference(result, "content", {});
    expect(ref.filter_result).toBe("HUMAN_APPROVED");
  });

  test("generates UUID for id", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      {}
    );
    expect(ref.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("generates SHA-256 content hash", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "hello world",
      {}
    );
    expect(ref.content_hash).toHaveLength(64);
    // Same content = same hash
    const ref2 = createTypedReference(
      makeFilterResult("ALLOWED"),
      "hello world",
      {}
    );
    expect(ref2.content_hash).toBe(ref.content_hash);
  });

  test("generates ISO 8601 timestamp for consumed_at", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      {}
    );
    expect(() => new Date(ref.consumed_at)).not.toThrow();
    expect(ref.consumed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("extracts origin from file path", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED", "repos/pai-collab/blackboard/PROJECT.yaml"),
      "content",
      {}
    );
    expect(ref.origin).toBe("blackboard/PROJECT.yaml");
  });

  test("stores source_file from FilterResult", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED", "/some/path/file.yaml"),
      "content",
      {}
    );
    expect(ref.source_file).toBe("/some/path/file.yaml");
  });
});

// ============================================================
// T-3.2 continued: Rejection cases
// ============================================================

describe("createTypedReference rejection", () => {
  test("throws for BLOCKED decision", () => {
    expect(() =>
      createTypedReference(makeFilterResult("BLOCKED"), "content", {})
    ).toThrow();
  });

  test("throws for HUMAN_REVIEW decision", () => {
    expect(() =>
      createTypedReference(makeFilterResult("HUMAN_REVIEW"), "content", {})
    ).toThrow();
  });

  test("throws for HUMAN_REJECTED decision", () => {
    expect(() =>
      createTypedReference(makeFilterResult("HUMAN_REJECTED"), "content", {})
    ).toThrow();
  });

  test("error message includes the decision", () => {
    try {
      createTypedReference(makeFilterResult("BLOCKED"), "content", {});
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect((e as Error).message).toContain("BLOCKED");
    }
  });
});

// ============================================================
// T-3.3: validateProvenance
// ============================================================

describe("validateProvenance", () => {
  test("returns valid for correct reference", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      { name: "test" }
    );
    const result = validateProvenance(ref);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("returns invalid for missing fields", () => {
    const partial = { id: "not-a-uuid", trust_level: "untrusted" };
    const result = validateProvenance(partial as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("returns invalid for bad trust_level", () => {
    const bad = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      origin: "test",
      trust_level: "trusted",
      content_hash: "a".repeat(64),
      filter_result: "PASSED",
      consumed_at: "2026-01-31T14:00:00.000Z",
      format: "yaml",
      data: {},
      source_file: "test.yaml",
    };
    const result = validateProvenance(bad as any);
    expect(result.valid).toBe(false);
  });

  test("includes error messages for each invalid field", () => {
    const result = validateProvenance({} as any);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ============================================================
// T-3.4: Immutability
// ============================================================

describe("immutability", () => {
  test("created reference is frozen", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      {}
    );
    expect(Object.isFrozen(ref)).toBe(true);
  });

  test("modification attempt throws in strict mode", () => {
    "use strict";
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      {}
    );
    expect(() => {
      (ref as any).trust_level = "trusted";
    }).toThrow();
  });

  test("cannot add new properties", () => {
    "use strict";
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      {}
    );
    expect(() => {
      (ref as any).newField = "value";
    }).toThrow();
  });
});

// ============================================================
// T-3.5: Serialization round-trip
// ============================================================

describe("serialization", () => {
  test("JSON round-trip preserves all fields", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "test content",
      { name: "project", version: "1.0" }
    );
    const json = JSON.stringify(ref);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(ref.id);
    expect(parsed.origin).toBe(ref.origin);
    expect(parsed.trust_level).toBe(ref.trust_level);
    expect(parsed.content_hash).toBe(ref.content_hash);
    expect(parsed.filter_result).toBe(ref.filter_result);
    expect(parsed.consumed_at).toBe(ref.consumed_at);
    expect(parsed.format).toBe(ref.format);
    expect(parsed.data).toEqual(ref.data);
    expect(parsed.source_file).toBe(ref.source_file);
  });

  test("deserialized reference passes provenance validation", () => {
    const ref = createTypedReference(
      makeFilterResult("ALLOWED"),
      "content",
      { key: "value" }
    );
    const deserialized = JSON.parse(JSON.stringify(ref));
    const result = validateProvenance(deserialized);
    expect(result.valid).toBe(true);
  });

  test("round-trip works for all valid filter results", () => {
    for (const decision of ["ALLOWED", "OVERRIDE", "HUMAN_APPROVED"]) {
      const ref = createTypedReference(
        makeFilterResult(decision),
        "content",
        {}
      );
      const deserialized = JSON.parse(JSON.stringify(ref));
      expect(validateProvenance(deserialized).valid).toBe(true);
    }
  });
});

// ============================================================
// extractOrigin
// ============================================================

describe("extractOrigin", () => {
  test("extracts last two path segments", () => {
    expect(extractOrigin("repos/pai-collab/blackboard/PROJECT.yaml")).toBe(
      "blackboard/PROJECT.yaml"
    );
  });

  test("handles single segment", () => {
    expect(extractOrigin("file.yaml")).toBe("file.yaml");
  });

  test("handles two segments", () => {
    expect(extractOrigin("dir/file.yaml")).toBe("dir/file.yaml");
  });

  test("handles deeply nested paths", () => {
    expect(extractOrigin("/a/b/c/d/e/file.yaml")).toBe("e/file.yaml");
  });
});
