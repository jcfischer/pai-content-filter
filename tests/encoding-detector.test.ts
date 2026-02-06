import { describe, expect, test } from "bun:test";
import { detectEncoding, looksLikeIdentifier } from "../src/lib/encoding-detector";
import type { EncodingRule } from "../src/lib/types";

// --- Test fixture rules matching the YAML config ---

const BASE64_RULE: EncodingRule = {
  id: "EN-001",
  type: "base64",
  pattern: "(?:[A-Za-z0-9+\\/]{21,}={0,2})",
  description: "Base64-encoded strings longer than 20 characters",
  min_length: 20,
};

const UNICODE_RULE: EncodingRule = {
  id: "EN-002",
  type: "unicode",
  pattern: "(?:\\\\u[0-9a-fA-F]{4}|\\\\x[0-9a-fA-F]{2}){3,}",
  description: "Unicode or hex escape sequences (3+ consecutive)",
};

const HEX_RULE: EncodingRule = {
  id: "EN-003",
  type: "hex",
  pattern: "(?:0x[0-9a-fA-F]{2}\\s*){5,}",
  description: "Hex-encoded text blocks (5+ consecutive hex bytes)",
};

const URL_ENCODED_RULE: EncodingRule = {
  id: "EN-004",
  type: "url_encoded",
  pattern: "(?:%[0-9a-fA-F]{2}){4,}",
  description: "URL-encoded strings (4+ consecutive encoded chars)",
};

const HTML_ENTITY_RULE: EncodingRule = {
  id: "EN-005",
  type: "html_entity",
  pattern: "(?:&#x?[0-9a-fA-F]+;){3,}",
  description: "HTML numeric entities used for obfuscation (3+ consecutive)",
};

const MULTI_FILE_SPLIT_RULE: EncodingRule = {
  id: "EN-006",
  type: "multi_file_split",
  pattern:
    "(?:(?:continued|part\\s+\\d+)\\s+(?:in|from|see)\\s+(?:file|document)|assemble\\s+(?:from|with)\\s+(?:other\\s+)?(?:files?|parts?)|split\\s+across\\s+(?:files?|documents?))",
  description: "Multi-file split patterns referencing content assembly",
};

const ALL_RULES: EncodingRule[] = [
  BASE64_RULE,
  UNICODE_RULE,
  HEX_RULE,
  URL_ENCODED_RULE,
  HTML_ENTITY_RULE,
  MULTI_FILE_SPLIT_RULE,
];

// =============================================================================
// Core contract tests
// =============================================================================

describe("detectEncoding", () => {
  describe("contract", () => {
    test("returns empty array for clean content", () => {
      const result = detectEncoding("This is normal text.\nNothing suspicious here.", ALL_RULES);
      expect(result).toEqual([]);
    });

    test("returns empty array for empty content", () => {
      const result = detectEncoding("", ALL_RULES);
      expect(result).toEqual([]);
    });

    test("returns empty array when no rules provided", () => {
      const result = detectEncoding("SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=", []);
      expect(result).toEqual([]);
    });

    test("returns EncodingMatch objects with required fields", () => {
      const result = detectEncoding("SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=", [BASE64_RULE]);
      expect(result.length).toBeGreaterThan(0);
      const match = result[0]!;
      expect(match).toHaveProperty("type");
      expect(match).toHaveProperty("matched_text");
      expect(match).toHaveProperty("line");
      expect(match).toHaveProperty("column");
    });

    test("line numbers are 1-based", () => {
      const result = detectEncoding("SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=", [BASE64_RULE]);
      expect(result[0]!.line).toBe(1);
    });

    test("column numbers are 1-based", () => {
      const result = detectEncoding("SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=", [BASE64_RULE]);
      expect(result[0]!.column).toBe(1);
    });
  });

  // ===========================================================================
  // Base64 detection (EN-001)
  // ===========================================================================

  describe("base64 detection", () => {
    test("detects base64 string meeting min_length", () => {
      // "Hello World this is base64" in base64
      const b64 = "SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("base64");
    });

    test("rejects base64 string below min_length", () => {
      // Short base64 string (< 20 chars)
      const result = detectEncoding("SGVsbG8=", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("detects base64 with trailing padding", () => {
      const b64 = "dGhpcyBpcyBhIHRlc3Qgc3RyaW5n";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("base64");
    });

    test("detects base64 embedded in text", () => {
      const content = "data: SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ= end";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.column).toBeGreaterThan(1);
    });

    test("detects multiple base64 strings on different lines", () => {
      const content = [
        "line one is clean",
        "hidden: SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=",
        "also clean",
        "another: dGhpcyBpcyBhbm90aGVyIHRlc3Q=",
      ].join("\n");
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result.length).toBe(2);
      expect(result[0]!.line).toBe(2);
      expect(result[1]!.line).toBe(4);
    });

    test("base64 rule with min_length 20 skips 19-char matches", () => {
      // Exactly 19 base64 chars -- below the regex {21,} threshold anyway
      const shortB64 = "AAAAAAAAAAAAAAAAAAA"; // 19 chars
      const result = detectEncoding(shortB64, [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("base64 rule matches exactly at min_length boundary", () => {
      // Exactly 21 chars (pattern requires 21+ from regex, min_length 20)
      const exactB64 = "AAAAAAAAAAAAAAAAAAAAA"; // 21 A's
      const result = detectEncoding(exactB64, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });
  });

  // ===========================================================================
  // Unicode escape detection (EN-002)
  // ===========================================================================

  describe("unicode escape detection", () => {
    test("detects 3+ consecutive unicode escapes", () => {
      const content = "\\u0048\\u0065\\u006C"; // H, e, l
      const result = detectEncoding(content, [UNICODE_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("unicode");
    });

    test("detects hex escapes (\\x format)", () => {
      const content = "\\x48\\x65\\x6C\\x6C\\x6F";
      const result = detectEncoding(content, [UNICODE_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("unicode");
    });

    test("ignores fewer than 3 consecutive unicode escapes", () => {
      const content = "some text \\u0048\\u0065 more text";
      const result = detectEncoding(content, [UNICODE_RULE]);
      expect(result).toEqual([]);
    });

    test("detects mixed \\u and \\x sequences", () => {
      const content = "\\u0048\\x65\\u006C";
      const result = detectEncoding(content, [UNICODE_RULE]);
      expect(result.length).toBe(1);
    });
  });

  // ===========================================================================
  // Hex detection (EN-003)
  // ===========================================================================

  describe("hex detection", () => {
    test("detects 5+ consecutive hex bytes", () => {
      const content = "0x48 0x65 0x6C 0x6C 0x6F";
      const result = detectEncoding(content, [HEX_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("hex");
    });

    test("ignores fewer than 5 hex bytes", () => {
      const content = "0x48 0x65 0x6C 0x6C";
      const result = detectEncoding(content, [HEX_RULE]);
      expect(result).toEqual([]);
    });

    test("detects hex bytes without spaces (compact)", () => {
      const content = "0x480x650x6C0x6C0x6F";
      const result = detectEncoding(content, [HEX_RULE]);
      expect(result.length).toBe(1);
    });
  });

  // ===========================================================================
  // URL-encoded detection (EN-004)
  // ===========================================================================

  describe("url_encoded detection", () => {
    test("detects 4+ consecutive url-encoded chars", () => {
      const content = "%6A%61%76%61"; // "java"
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("url_encoded");
    });

    test("ignores fewer than 4 consecutive url-encoded chars", () => {
      const content = "%6A%61%76";
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result).toEqual([]);
    });

    test("skips url-encoded chars inside actual URLs", () => {
      const content = "https://example.com/path%20with%20some%20spaces%20here";
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result).toEqual([]);
    });

    test("detects url-encoded chars not inside URLs", () => {
      const content = "payload: %6A%61%76%61%73%63%72%69%70%74";
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result.length).toBe(1);
    });

    test("skips url-encoded inside https URLs", () => {
      const content = "see https://example.com/api?q=%20%20%20%20 for details";
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result).toEqual([]);
    });

    test("skips url-encoded inside http URLs", () => {
      const content = "http://example.com/%61%62%63%64";
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // HTML entity detection (EN-005)
  // ===========================================================================

  describe("html_entity detection", () => {
    test("detects 3+ consecutive HTML numeric entities", () => {
      const content = "&#x6A;&#x61;&#x76;"; // j, a, v
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("html_entity");
    });

    test("detects decimal HTML entities", () => {
      const content = "&#106;&#97;&#118;";
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result.length).toBe(1);
    });

    test("ignores fewer than 3 consecutive entities", () => {
      const content = "&#x6A;&#x61;";
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result).toEqual([]);
    });

    test("detects obfuscated javascript: protocol", () => {
      const content = "&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;";
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result.length).toBe(1);
    });
  });

  // ===========================================================================
  // Multi-file split detection (EN-006)
  // ===========================================================================

  describe("multi_file_split detection", () => {
    test("detects 'continued in file' pattern", () => {
      const content = "continued in file part2.yaml";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("multi_file_split");
    });

    test("detects 'part N from file' pattern", () => {
      const content = "part 2 from file instructions.md";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result.length).toBe(1);
    });

    test("detects 'assemble from files' pattern", () => {
      const content = "assemble from other files to complete the payload";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result.length).toBe(1);
    });

    test("detects 'split across documents' pattern", () => {
      const content = "this content is split across documents";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result.length).toBe(1);
    });

    test("does not match ordinary text", () => {
      const content = "We continued the meeting. Part of the discussion was about files.";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Cross-cutting behavior
  // ===========================================================================

  describe("cross-cutting behavior", () => {
    test("detects multiple encoding types in same content", () => {
      const content = [
        "base64: SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=",
        "unicode: \\u0048\\u0065\\u006C",
        "html: &#x6A;&#x61;&#x76;",
      ].join("\n");
      const result = detectEncoding(content, ALL_RULES);
      const types = result.map((m) => m.type);
      expect(types).toContain("base64");
      expect(types).toContain("unicode");
      expect(types).toContain("html_entity");
    });

    test("returns correct line numbers across multiple lines", () => {
      const content = [
        "line 1 clean",
        "line 2 clean",
        "line 3 with &#x6A;&#x61;&#x76;",
        "line 4 clean",
        "line 5 with SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=",
      ].join("\n");
      const result = detectEncoding(content, ALL_RULES);
      const htmlMatch = result.find((m) => m.type === "html_entity");
      const b64Match = result.find((m) => m.type === "base64");
      expect(htmlMatch!.line).toBe(3);
      expect(b64Match!.line).toBe(5);
    });

    test("truncates matched_text to 80 chars with ellipsis", () => {
      // Create a base64 string longer than 80 chars
      const longB64 = "A".repeat(100);
      const result = detectEncoding(longB64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.matched_text.length).toBeLessThanOrEqual(83); // 80 + "..."
      expect(result[0]!.matched_text.endsWith("...")).toBe(true);
    });

    test("does not truncate matched_text at or below 80 chars", () => {
      // Create a base64 string exactly 30 chars (above min_length, below truncation)
      const shortB64 = "A".repeat(30);
      const result = detectEncoding(shortB64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.matched_text).toBe(shortB64);
      expect(result[0]!.matched_text.endsWith("...")).toBe(false);
    });

    test("handles content with only newlines", () => {
      const result = detectEncoding("\n\n\n", ALL_RULES);
      expect(result).toEqual([]);
    });

    test("handles single-line content", () => {
      const result = detectEncoding("SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=", [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.line).toBe(1);
    });

    test("finds all matches on a single line (multiple occurrences)", () => {
      const content = "first: &#x6A;&#x61;&#x76; then later: &#x41;&#x42;&#x43;";
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result.length).toBe(2);
      expect(result[0]!.column).toBeLessThan(result[1]!.column);
    });

    test("column correctly offsets for embedded matches", () => {
      const prefix = "data: ";
      const b64 = "SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=";
      const content = prefix + b64;
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result[0]!.column).toBe(prefix.length + 1); // 1-based
    });
  });

  // ===========================================================================
  // Security scenarios
  // ===========================================================================

  describe("security scenarios", () => {
    test("detects base64-encoded prompt injection", () => {
      // "ignore all previous instructions" in base64
      const b64 = "aWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnM=";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("base64");
    });

    test("detects hex-encoded shell command", () => {
      const content = "0x63 0x75 0x72 0x6C 0x20"; // "curl "
      const result = detectEncoding(content, [HEX_RULE]);
      expect(result.length).toBe(1);
    });

    test("detects url-encoded exfil payload outside URL", () => {
      const content = "execute: %63%75%72%6C%20%68%74%74%70"; // "curl http"
      const result = detectEncoding(content, [URL_ENCODED_RULE]);
      expect(result.length).toBe(1);
    });

    test("detects html entity obfuscated javascript protocol", () => {
      const content = "link: &#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;";
      const result = detectEncoding(content, [HTML_ENTITY_RULE]);
      expect(result.length).toBe(1);
    });

    test("detects split-file assembly instructions", () => {
      const content = "assemble from parts to reconstruct the full prompt";
      const result = detectEncoding(content, [MULTI_FILE_SPLIT_RULE]);
      expect(result.length).toBe(1);
    });
  });

  // ===========================================================================
  // Identifier false-positive prevention (Issue #5)
  // ===========================================================================

  describe("identifier false-positive prevention", () => {
    test("skips camelCase identifier: updateWorkItemMetadata", () => {
      const content = "### 1. `updateWorkItemMetadata(itemId, metadataUpdates)`";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("skips camelCase identifier: getWorkItemStatus", () => {
      const result = detectEncoding("getWorkItemStatus", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("skips camelCase identifier: handleUserAuthenticationFlow", () => {
      const result = detectEncoding("handleUserAuthenticationFlow", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("skips PascalCase identifier: UpdateWorkItemMetadata", () => {
      const result = detectEncoding("UpdateWorkItemMetadata", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("skips PascalCase identifier: ContentFilterPipeline", () => {
      const result = detectEncoding("ContentFilterPipeline", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("skips snake_case identifier: update_work_item_metadata", () => {
      const result = detectEncoding("update_work_item_metadata", [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("still detects real base64 with padding", () => {
      const b64 = "SGVsbG8gV29ybGQgdGhpcyBpcyBiYXNlNjQ=";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
      expect(result[0]!.type).toBe("base64");
    });

    test("still detects real base64 without padding", () => {
      const b64 = "dGhpcyBpcyBhIHRlc3Qgc3RyaW5n"; // "this is a test string"
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });

    test("still detects base64 with + character", () => {
      const b64 = "SGVsbG8rV29ybGQrdGVzdA+test";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });

    test("still detects base64 with / character", () => {
      const b64 = "SGVsbG8vV29ybGQvdGVzdA/test";
      const result = detectEncoding(b64, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });

    test("skips long method chain name", () => {
      const content = "createTypedReferenceFromContent";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("does not skip all-lowercase string without transitions", () => {
      // All lowercase, no transitions — could be base64
      const content = "abcdefghijklmnopqrstuvwxyz";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });

    test("does not skip all-uppercase string without transitions", () => {
      // All uppercase, no transitions — could be base64
      const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result.length).toBe(1);
    });

    test("skips identifier in markdown code reference", () => {
      const content = "`filterContentString` processes the input";
      const result = detectEncoding(content, [BASE64_RULE]);
      expect(result).toEqual([]);
    });

    test("only affects base64 rule, not other encoding rules", () => {
      // Ensure the identifier check only applies to base64
      const content = "\\u0048\\u0065\\u006C";
      const result = detectEncoding(content, [UNICODE_RULE]);
      expect(result.length).toBe(1);
    });
  });
});

// =============================================================================
// looksLikeIdentifier unit tests
// =============================================================================

describe("looksLikeIdentifier", () => {
  test("detects camelCase", () => {
    expect(looksLikeIdentifier("updateWorkItemMetadata")).toBe(true);
  });

  test("detects PascalCase", () => {
    expect(looksLikeIdentifier("UpdateWorkItemMetadata")).toBe(true);
  });

  test("detects snake_case", () => {
    expect(looksLikeIdentifier("update_work_item_metadata")).toBe(true);
  });

  test("rejects padded base64", () => {
    expect(looksLikeIdentifier("SGVsbG8gV29ybGQ=")).toBe(false);
  });

  test("rejects base64 with +", () => {
    expect(looksLikeIdentifier("SGVsbG8+V29ybGQ")).toBe(false);
  });

  test("rejects base64 with /", () => {
    expect(looksLikeIdentifier("SGVsbG8/V29ybGQ")).toBe(false);
  });

  test("rejects all-lowercase (no transitions)", () => {
    expect(looksLikeIdentifier("abcdefghijklmnopqrst")).toBe(false);
  });

  test("rejects all-uppercase (no transitions)", () => {
    expect(looksLikeIdentifier("ABCDEFGHIJKLMNOPQRST")).toBe(false);
  });

  test("rejects two segments (insufficient)", () => {
    // Only 2 segments: "get" + "Work" — needs at least 3
    expect(looksLikeIdentifier("getWork")).toBe(false);
  });

  test("accepts three segments (minimum)", () => {
    // 3 segments: "get" + "Work" + "Item"
    expect(looksLikeIdentifier("getWorkItem")).toBe(true);
  });

  test("rejects string starting with number", () => {
    expect(looksLikeIdentifier("123updateWorkItem")).toBe(false);
  });

  test("accepts identifier starting with underscore", () => {
    expect(looksLikeIdentifier("_privateMethodName")).toBe(true);
  });

  test("rejects random mixed case without structure", () => {
    // Has transitions but also has base64 chars like /
    expect(looksLikeIdentifier("aB/cD")).toBe(false);
  });
});
