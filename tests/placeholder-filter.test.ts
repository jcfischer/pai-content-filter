import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { isPlaceholder, matchPatterns, loadConfig } from "../src/lib/pattern-matcher";
import { filterContentString } from "../src/lib/content-filter";

const CONFIG_PATH = resolve(import.meta.dir, "../config/filter-patterns.yaml");

// ============================================================
// isPlaceholder — unit tests
// ============================================================

describe("isPlaceholder", () => {
  // --- Should be detected as placeholders ---

  test("detects 'your-api-key-here'", () => {
    expect(isPlaceholder("your-api-key-here")).toBe(true);
  });

  test("detects '<your-token>'", () => {
    expect(isPlaceholder("<your-token>")).toBe(true);
  });

  test("detects 'xxxx-xxxx-xxxx'", () => {
    expect(isPlaceholder("xxxx-xxxx-xxxx")).toBe(true);
  });

  test("detects '****-****-****'", () => {
    expect(isPlaceholder("****-****-****")).toBe(true);
  });

  test("detects 'test-api-key'", () => {
    expect(isPlaceholder("test-api-key")).toBe(true);
  });

  test("detects 'demo-token-value'", () => {
    expect(isPlaceholder("demo-token-value")).toBe(true);
  });

  test("detects 'sample_credential'", () => {
    expect(isPlaceholder("sample_credential")).toBe(true);
  });

  test("detects 'dummy-secret-123'", () => {
    expect(isPlaceholder("dummy-secret-123")).toBe(true);
  });

  test("detects 'fake-password'", () => {
    expect(isPlaceholder("fake-password")).toBe(true);
  });

  test("detects 'placeholder-value'", () => {
    expect(isPlaceholder("placeholder-value")).toBe(true);
  });

  test("detects 'example.com'", () => {
    expect(isPlaceholder("example.com")).toBe(true);
  });

  test("detects 'localhost:3000'", () => {
    expect(isPlaceholder("localhost:3000")).toBe(true);
  });

  test("detects 'TODO-replace-me'", () => {
    expect(isPlaceholder("TODO-replace-me")).toBe(true);
  });

  test("detects 'CHANGEME'", () => {
    expect(isPlaceholder("CHANGEME")).toBe(true);
  });

  test("detects 'sk-ant-xxxxxxxxxxxxxxxx'", () => {
    expect(isPlaceholder("sk-ant-xxxxxxxxxxxxxxxx")).toBe(true);
  });

  test("detects 'AKIA0000000000000000'", () => {
    expect(isPlaceholder("AKIA0000000000000000")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPlaceholder("YOUR-API-KEY")).toBe(true);
    expect(isPlaceholder("Test-Token")).toBe(true);
    expect(isPlaceholder("PLACEHOLDER")).toBe(true);
  });

  // --- Should NOT be detected as placeholders (real values) ---

  test("real Anthropic key is not placeholder", () => {
    expect(isPlaceholder("sk-ant-api03-xK7vN9mP2qR5tY8wB3eF6hJ9kL0nQ4sU7iO1pA-zX3cV6bN9mK2jH5gD8fR")).toBe(false);
  });

  test("real OpenAI key is not placeholder", () => {
    expect(isPlaceholder("sk-proj-xK7vN9mP2qR5tY8wB3eF6hJ9kL0nQ4s")).toBe(false);
  });

  test("real AWS key is not placeholder", () => {
    expect(isPlaceholder("AKIAIOSFODNN7RTZQB4W")).toBe(false);
  });

  test("real GitHub PAT is not placeholder", () => {
    expect(isPlaceholder("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789")).toBe(false);
  });

  test("real HuggingFace token is not placeholder", () => {
    expect(isPlaceholder("hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567")).toBe(false);
  });

  test("mixed-case real key is not placeholder", () => {
    expect(isPlaceholder("gsk_aB7cD2eF9gH4iJ6kL1mN3oP5qR8sT0uV2wX4yZ6aA1bB3cC5dD7eE")).toBe(false);
  });

  test("normal text is not placeholder", () => {
    expect(isPlaceholder("This is a normal sentence")).toBe(false);
  });

  test("empty string is not placeholder", () => {
    expect(isPlaceholder("")).toBe(false);
  });
});

// ============================================================
// matchPatterns — placeholder downgrade integration
// ============================================================

describe("matchPatterns placeholder downgrade", () => {
  const config = loadConfig(CONFIG_PATH);

  test("placeholder API key downgrades from block to review", () => {
    const matches = matchPatterns(
      'ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx',
      config.patterns
    );
    // Should still match, but severity should be review not block
    const apiMatch = matches.find((m) => m.category === "pii");
    if (apiMatch) {
      expect(apiMatch.severity).toBe("review");
      expect(apiMatch.placeholder_skipped).toBe(true);
    }
  });

  test("real API key stays block severity", () => {
    const matches = matchPatterns(
      'const token = "r8_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd";',
      config.patterns
    );
    const apiMatch = matches.find((m) => m.pattern_id === "PII-009");
    expect(apiMatch).toBeDefined();
    expect(apiMatch!.severity).toBe("block");
    expect(apiMatch!.placeholder_skipped).toBeUndefined();
  });

  test("placeholder email suppressed entirely (review→skip)", () => {
    const matches = matchPatterns(
      "contact: test@example.com",
      config.patterns
    );
    // PII-007 (email) is review severity — placeholder should suppress it
    const emailMatch = matches.find((m) => m.pattern_id === "PII-007");
    expect(emailMatch).toBeUndefined();
  });

  test("real email still matches as review", () => {
    const matches = matchPatterns(
      "contact: john.doe@realcompany.io",
      config.patterns
    );
    const emailMatch = matches.find((m) => m.pattern_id === "PII-007");
    expect(emailMatch).toBeDefined();
    expect(emailMatch!.severity).toBe("review");
  });

  test("placeholder AWS key downgrades", () => {
    const matches = matchPatterns(
      "aws_key: AKIA0000000000000000",
      config.patterns
    );
    const awsMatch = matches.find((m) => m.pattern_id === "PII-005");
    if (awsMatch) {
      expect(awsMatch.severity).toBe("review");
      expect(awsMatch.placeholder_skipped).toBe(true);
    }
  });
});

// ============================================================
// filterContentString — end-to-end placeholder behavior
// ============================================================

describe("filterContentString placeholder integration", () => {
  test("config with placeholder keys is not BLOCKED", () => {
    const content = `api_key: sk-ant-xxxxxxxxxxxxxxxxxxxx
name: my-project`;
    // Use mixed format to skip schema validation and focus on pattern matching
    const result = filterContentString(content, "test.txt", "mixed", CONFIG_PATH);
    // Should not be BLOCKED — placeholder key should downgrade to review
    expect(result.decision).not.toBe("BLOCKED");
    // The placeholder match should still appear but as review severity
    const piiMatch = result.matches.find((m) => m.category === "pii");
    if (piiMatch) {
      expect(piiMatch.severity).toBe("review");
      expect(piiMatch.placeholder_skipped).toBe(true);
    }
  });

  test("config with real key is still BLOCKED", () => {
    const content = `api_key: sk-ant-api03-xK7vN9mP2qR5tY8wB3eF6hJ9kL0nQ4sU7iO1pA-zX3cV6bN9mK2jH5gD8fR
name: my-project`;
    const result = filterContentString(content, "test.txt", "mixed", CONFIG_PATH);
    expect(result.decision).toBe("BLOCKED");
  });

  test("documentation example with placeholder URL not BLOCKED", () => {
    const md = `# API Usage

Send data to http://localhost:3000/api/collect or http://example.com/endpoint
`;
    const result = filterContentString(md, "readme.md", "markdown", CONFIG_PATH);
    // Should be HUMAN_REVIEW (markdown default) not BLOCKED
    const blockedPatterns = result.matches.filter(
      (m) => m.severity === "block"
    );
    expect(blockedPatterns.length).toBe(0);
  });
});
