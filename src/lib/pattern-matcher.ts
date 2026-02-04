import {
  type FilterPattern,
  type PatternMatch,
  type FilterConfig,
  FilterConfigSchema,
} from "./types";

/**
 * Minimal YAML parser for our specific config format.
 * Handles: top-level string keys, arrays of flat objects with string/number values.
 * Supports single-quoted strings (for regex patterns containing special chars).
 * NOT a general-purpose YAML parser.
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  let currentKey = "";
  let currentArray: Record<string, unknown>[] = [];
  let currentObject: Record<string, unknown> | null = null;
  let inArray = false;

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine);
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();

    // Top-level key (indent 0): "version: ..." or "patterns:" or "encoding_rules:"
    if (indent === 0 && trimmed.includes(":")) {
      // Save previous array if we were collecting one
      if (inArray && currentKey) {
        if (currentObject) {
          currentArray.push(currentObject);
          currentObject = null;
        }
        result[currentKey] = currentArray;
      }

      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      const valuePart = trimmed.slice(colonIdx + 1).trim();

      if (valuePart === "" || valuePart === undefined) {
        // Array or nested object follows
        currentKey = key;
        currentArray = [];
        currentObject = null;
        inArray = true;
      } else {
        // Simple scalar value
        result[key] = parseYamlValue(valuePart);
        inArray = false;
      }
      continue;
    }

    // Array item start: "  - key: value" (indent 2+, starts with "- ")
    if (inArray && trimmed.startsWith("- ")) {
      // Save previous object if any
      if (currentObject) {
        currentArray.push(currentObject);
      }
      currentObject = {};
      const rest = trimmed.slice(2).trim();
      if (rest.includes(":")) {
        const { key: k, value: v } = splitKeyValue(rest);
        currentObject[k] = parseYamlValue(v);
      }
      continue;
    }

    // Object property inside array item: "    key: value" (indent 4+)
    if (inArray && currentObject && indent >= 4 && trimmed.includes(":")) {
      const { key: k, value: v } = splitKeyValue(trimmed);
      currentObject[k] = parseYamlValue(v);
      continue;
    }
  }

  // Flush final array/object
  if (currentObject) currentArray.push(currentObject);
  if (inArray && currentKey) result[currentKey] = currentArray;

  return result;
}

/**
 * Split a "key: value" string at the FIRST colon followed by space (or end of string).
 * This handles regex patterns that contain colons internally.
 */
function splitKeyValue(text: string): { key: string; value: string } {
  // Match key: value where value may be quoted
  // The key is everything before the first ": " or ":" at end
  const match = text.match(/^([^:]+):\s*(.*)/);
  if (!match) {
    return { key: text.trim(), value: "" };
  }
  return { key: match[1]!.trim(), value: match[2]!.trim() };
}

/**
 * Parse a YAML value string, handling:
 * - Single-quoted strings: 'value' (no escape processing)
 * - Double-quoted strings: "value"
 * - Numbers
 * - Plain strings
 */
function parseYamlValue(raw: string): string | number {
  if (raw === "") return "";

  // Single-quoted string: take content between outermost single quotes
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }

  // Double-quoted string
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }

  // Number
  if (raw !== "" && !isNaN(Number(raw))) {
    return Number(raw);
  }

  // Plain string
  return raw;
}

/**
 * Strip YAML comments from a line, respecting single-quoted strings.
 * A '#' inside single quotes is NOT a comment.
 */
function stripYamlComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === "#" && !inSingleQuote && !inDoubleQuote) {
      // Check it's preceded by whitespace or is start of line
      if (i === 0 || line[i - 1] === " " || line[i - 1] === "\t") {
        return line.slice(0, i).trimEnd();
      }
    }
  }

  return line;
}

/**
 * Load and validate a filter configuration from a YAML file.
 *
 * Reads the YAML file, parses it with a minimal purpose-built parser,
 * validates with Zod schema, and verifies all regex patterns compile.
 * Throws on invalid config, invalid regex, or file read errors.
 */
export function loadConfig(configPath: string): FilterConfig {
  const fs = require("fs");
  const text = fs.readFileSync(configPath, "utf-8") as string;
  const raw = parseSimpleYaml(text);
  const config = FilterConfigSchema.parse(raw);

  // Validate all pattern regexes compile (fail-fast per R-004)
  for (const pattern of config.patterns) {
    try {
      new RegExp(pattern.pattern, "i");
    } catch (e) {
      throw new Error(
        `Invalid regex in pattern ${pattern.id}: ${pattern.pattern} -- ${e}`
      );
    }
  }

  // Validate all encoding rule regexes compile
  for (const rule of config.encoding_rules) {
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      throw new Error(
        `Invalid regex in encoding rule ${rule.id}: ${rule.pattern} -- ${e}`
      );
    }
  }

  return config;
}

/**
 * Tokens that indicate a value is a placeholder/dummy, not a real secret.
 * Applied to matched text (not the full line) to reduce false positives.
 * Inspired by MongoDB's Kingfisher approach.
 */
const PLACEHOLDER_TOKENS = [
  "test",
  "demo",
  "localhost",
  "example",
  "placeholder",
  "xxxx",
  "****",
  "sample",
  "dummy",
  "fake",
  "your-",
  "<your",
  "changeme",
  "todo",
  "replace",
  "0000000000",
];

/**
 * Check if a matched value is a placeholder/dummy that should not trigger a block.
 *
 * Strategy: check if the matched text contains placeholder tokens. For structured
 * API keys (prefixed like sk-ant-, AKIA, etc.), strip the prefix first and check
 * if the remaining value is dominated by placeholder characters (x, *, 0).
 *
 * Real keys with high entropy will not match. Placeholder keys like
 * "sk-ant-xxxxxxxxxxxx" or "AKIA0000000000000000" will.
 */
export function isPlaceholder(text: string): boolean {
  if (!text) return false;

  const lower = text.toLowerCase();

  // Direct token match — the value itself contains a placeholder word
  if (PLACEHOLDER_TOKENS.some((token) => lower.includes(token))) {
    return true;
  }

  // Structured key check: strip known prefixes, check if remainder is low-entropy
  const prefixPatterns = [
    /^sk-ant-(?:api\d*-)?/i,
    /^sk-(?:proj-)?/i,
    /^gh[pousr]_/i,
    /^(?:AKIA|ABIA|ACCA|ASIA)/,
    /^r8_/i,
    /^hf_/i,
    /^gsk_/i,
  ];

  for (const prefix of prefixPatterns) {
    const match = text.match(prefix);
    if (match) {
      const remainder = text.slice(match[0].length);
      if (remainder.length > 0 && isLowEntropy(remainder)) {
        return true;
      }
      break;
    }
  }

  return false;
}

/**
 * Check if a string has low entropy — dominated by repeated characters,
 * placeholder chars (x, X, *, 0), or is mostly the same character.
 * Returns true for "xxxxxxxxxxxx", "000000000", "********" etc.
 */
function isLowEntropy(text: string): boolean {
  const placeholderChars = new Set(["x", "X", "*", "0"]);
  let placeholderCount = 0;

  for (const ch of text) {
    if (placeholderChars.has(ch)) placeholderCount++;
  }

  // If 80%+ of the remainder is placeholder characters, it's low entropy
  return placeholderCount / text.length >= 0.8;
}

/**
 * Maximum line length to process. Lines longer than this are truncated
 * before regex matching to prevent ReDoS attacks via crafted input.
 * A 10KB line is far beyond any legitimate YAML/markdown content.
 */
const MAX_LINE_LENGTH = 10_000;

/**
 * Timeout in milliseconds for regex matching on a single line.
 * If a pattern takes longer than this, it's likely a ReDoS attempt.
 */
const REGEX_TIMEOUT_MS = 500;

/**
 * Match content against an array of filter patterns.
 *
 * Scans every line against every pattern (case-insensitive).
 * Returns ALL matches (not just first) with line/column positions.
 * Follows the same scanning pattern as encoding-detector.ts.
 *
 * ReDoS protection: lines are truncated at MAX_LINE_LENGTH and
 * regex execution is time-bounded per pattern per line.
 */
export function matchPatterns(
  content: string,
  patterns: FilterPattern[]
): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const lines = content.split("\n");

  for (const pattern of patterns) {
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      // Truncate long lines to prevent ReDoS
      const line =
        lines[lineIdx]!.length > MAX_LINE_LENGTH
          ? lines[lineIdx]!.slice(0, MAX_LINE_LENGTH)
          : lines[lineIdx]!;

      // Create fresh regex per line to reset state
      const regex = new RegExp(pattern.pattern, "gi");

      const lineMatches = safeRegexExec(regex, line, REGEX_TIMEOUT_MS);
      for (const match of lineMatches) {
        // Skip false positives in code block fences and inline code
        if (isInsideCodeContext(line, match.index)) continue;

        const matchedText = match.text.trim();

        // Placeholder filtering: check matched text for dummy/placeholder values
        if (isPlaceholder(matchedText)) {
          if (pattern.severity === "review") {
            // Review-severity placeholders are suppressed entirely
            continue;
          }
          // Block-severity placeholders downgrade to review
          matches.push({
            pattern_id: pattern.id,
            pattern_name: pattern.name,
            category: pattern.category,
            severity: "review",
            matched_text: matchedText,
            line: lineIdx + 1,
            column: match.index + 1,
            placeholder_skipped: true,
          });
          continue;
        }

        matches.push({
          pattern_id: pattern.id,
          pattern_name: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          matched_text: matchedText,
          line: lineIdx + 1,
          column: match.index + 1,
        });
      }
    }
  }

  return matches;
}

/**
 * Execute regex against a string with a time bound.
 *
 * Returns all matches found within the timeout. If the regex takes
 * too long (potential ReDoS), returns matches found so far.
 * This prevents pathological regex inputs from hanging the scanner.
 */
function safeRegexExec(
  regex: RegExp,
  line: string,
  timeoutMs: number
): Array<{ text: string; index: number }> {
  const results: Array<{ text: string; index: number }> = [];
  const startTime = performance.now();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    results.push({ text: match[0], index: match.index });

    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) regex.lastIndex++;

    // Check timeout
    if (performance.now() - startTime > timeoutMs) break;
  }

  return results;
}

/**
 * Check if a match position is inside a markdown code context.
 *
 * Returns true if the line is a code fence (``` or ~~~) or the match
 * appears inside backtick-delimited inline code. This reduces false
 * positives from code examples in documentation.
 */
function isInsideCodeContext(line: string, matchIndex: number): boolean {
  const trimmed = line.trimStart();

  // Code fence lines (``` or ~~~) — don't filter these
  if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) return true;

  // Check if match is inside inline backticks
  let inBacktick = false;
  let backtickStart = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "`") {
      if (!inBacktick) {
        inBacktick = true;
        backtickStart = i;
      } else {
        // End of inline code span
        if (matchIndex > backtickStart && matchIndex < i) return true;
        inBacktick = false;
      }
    }
  }

  return false;
}

/**
 * Validate a number using the Luhn algorithm (ISO/IEC 7812-1).
 *
 * Used to verify credit card numbers. The algorithm detects any
 * single-digit error and most transpositions of adjacent digits.
 * Returns true for valid card numbers, false for random digit sequences.
 *
 * Source: Microsoft Presidio patterns, adapted from Arbor's arbor_eval.
 */
export function luhnCheck(digits: string): boolean {
  const cleaned = digits.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(cleaned)) return false;

  let sum = 0;
  let alternate = false;

  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = parseInt(cleaned[i]!, 10);

    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }

    sum += n;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}
