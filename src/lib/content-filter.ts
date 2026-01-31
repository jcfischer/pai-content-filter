import type { AuditConfig, FileFormat, FilterResult } from "./types";
import { loadConfig, matchPatterns } from "./pattern-matcher";
import { detectEncoding } from "./encoding-detector";
import { validateSchema } from "./schema-validator";
import { resolve } from "path";
import {
  createAuditEntry,
  hashContent,
  generateSessionId,
  logAuditEntry,
} from "./audit";

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
  configPath?: string,
  auditConfig?: AuditConfig,
  auditOpts?: { sourceRepo?: string; sessionId?: string }
): FilterResult {
  const fs = require("fs") as typeof import("fs");
  const content = fs.readFileSync(filePath, "utf-8");
  const fileFormat = format ?? detectFormat(filePath);

  return filterContentString(
    content,
    filePath,
    fileFormat,
    configPath,
    auditConfig,
    auditOpts
  );
}

/**
 * Run the filter pipeline on a string (for testing and library use).
 */
export function filterContentString(
  content: string,
  filePath: string,
  format: FileFormat,
  configPath?: string,
  auditConfig?: AuditConfig,
  auditOpts?: { sourceRepo?: string; sessionId?: string }
): FilterResult {
  const config = loadConfig(configPath ?? CONFIG_PATH);

  // Step 1: Encoding detection — short-circuit on match
  const encodings = detectEncoding(content, config.encoding_rules);
  if (encodings.length > 0) {
    const result: FilterResult = {
      decision: "BLOCKED",
      matches: [],
      encodings,
      schema_valid: false,
      file: filePath,
      format,
    };
    maybeLogAudit(result, content, auditConfig, auditOpts);
    return result;
  }

  // Step 2: Schema validation (structured formats only)
  let schemaValid = true;
  if (format === "yaml" || format === "json") {
    const schemaResult = validateSchema(content, format);
    schemaValid = schemaResult.valid;
    if (!schemaValid) {
      const result: FilterResult = {
        decision: "BLOCKED",
        matches: [],
        encodings: [],
        schema_valid: false,
        file: filePath,
        format,
      };
      maybeLogAudit(result, content, auditConfig, auditOpts);
      return result;
    }
  }

  // Step 3: Pattern matching
  const matches = matchPatterns(content, config.patterns);

  // Step 4: Decision logic
  const hasBlockMatch = matches.some((m) => m.severity === "block");

  if (hasBlockMatch) {
    const result: FilterResult = {
      decision: "BLOCKED",
      matches,
      encodings: [],
      schema_valid: schemaValid,
      file: filePath,
      format,
    };
    maybeLogAudit(result, content, auditConfig, auditOpts);
    return result;
  }

  // Free-text always requires human review, even when clean
  if (format === "markdown" || format === "mixed") {
    const result: FilterResult = {
      decision: "HUMAN_REVIEW",
      matches,
      encodings: [],
      schema_valid: schemaValid,
      file: filePath,
      format,
    };
    maybeLogAudit(result, content, auditConfig, auditOpts);
    return result;
  }

  // Structured format, clean
  const result: FilterResult = {
    decision: "ALLOWED",
    matches,
    encodings: [],
    schema_valid: schemaValid,
    file: filePath,
    format,
  };
  maybeLogAudit(result, content, auditConfig, auditOpts);
  return result;
}

/**
 * Log audit entry if auditConfig is provided. Fail-open.
 */
function maybeLogAudit(
  result: FilterResult,
  content: string,
  auditConfig?: AuditConfig,
  opts?: { sourceRepo?: string; sessionId?: string }
): void {
  if (!auditConfig) return;

  try {
    const entry = createAuditEntry(result, {
      contentHash: hashContent(content),
      sessionId: opts?.sessionId ?? generateSessionId(),
      sourceRepo: opts?.sourceRepo,
    });
    logAuditEntry(entry, auditConfig);
  } catch {
    // Fail-open: audit failure does not block the filter pipeline
  }
}
