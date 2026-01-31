import type { FileFormat, FilterResult } from "./types";
import { loadConfig, matchPatterns } from "./pattern-matcher";
import { detectEncoding } from "./encoding-detector";
import { validateSchema } from "./schema-validator";
import { resolve } from "path";

const CONFIG_PATH = resolve(import.meta.dir, "../../config/filter-patterns.yaml");

/**
 * Detect file format from extension.
 */
export function detectFormat(filePath: string): FileFormat {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "yaml":
    case "yml":
      return "yaml";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    default:
      return "mixed";
  }
}

/**
 * Run the full content filter pipeline on a file.
 *
 * Pipeline order (per R-005):
 * 1. Detect file format
 * 2. Encoding detection — BLOCK immediately if found
 * 3. Schema validation (structured formats) — BLOCK if fails
 * 4. Pattern matching
 * 5. Decision logic
 */
export function filterContent(
  filePath: string,
  format?: FileFormat,
  configPath?: string
): FilterResult {
  const fs = require("fs") as typeof import("fs");
  const content = fs.readFileSync(filePath, "utf-8");
  const fileFormat = format ?? detectFormat(filePath);

  return filterContentString(content, filePath, fileFormat, configPath);
}

/**
 * Run the filter pipeline on a string (for testing and library use).
 */
export function filterContentString(
  content: string,
  filePath: string,
  format: FileFormat,
  configPath?: string
): FilterResult {
  const config = loadConfig(configPath ?? CONFIG_PATH);

  // Step 1: Encoding detection — short-circuit on match
  const encodings = detectEncoding(content, config.encoding_rules);
  if (encodings.length > 0) {
    return {
      decision: "BLOCKED",
      matches: [],
      encodings,
      schema_valid: false,
      file: filePath,
      format,
    };
  }

  // Step 2: Schema validation (structured formats only)
  let schemaValid = true;
  if (format === "yaml" || format === "json") {
    const schemaResult = validateSchema(content, format);
    schemaValid = schemaResult.valid;
    if (!schemaValid) {
      return {
        decision: "BLOCKED",
        matches: [],
        encodings: [],
        schema_valid: false,
        file: filePath,
        format,
      };
    }
  }

  // Step 3: Pattern matching
  const matches = matchPatterns(content, config.patterns);

  // Step 4: Decision logic
  const hasBlockMatch = matches.some((m) => m.severity === "block");

  if (hasBlockMatch) {
    return {
      decision: "BLOCKED",
      matches,
      encodings: [],
      schema_valid: schemaValid,
      file: filePath,
      format,
    };
  }

  // Free-text always requires human review, even when clean
  if (format === "markdown" || format === "mixed") {
    return {
      decision: "HUMAN_REVIEW",
      matches,
      encodings: [],
      schema_valid: schemaValid,
      file: filePath,
      format,
    };
  }

  // Structured format, clean
  return {
    decision: "ALLOWED",
    matches,
    encodings: [],
    schema_valid: schemaValid,
    file: filePath,
    format,
  };
}
