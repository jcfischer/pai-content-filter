import type {
  AuditConfig,
  DecodedMatch,
  FileFormat,
  FilterConfig,
  FilterResult,
  HeuristicResult,
  PatternMatch,
} from "./types";
import { loadConfig, loadConfigFromString, matchPatterns } from "./pattern-matcher";
import { detectEncoding } from "./encoding-detector";
import { validateSchema } from "./schema-validator";
import { scoreDetections, overallScore } from "./scoring";
import { scoreHeuristic } from "./heuristic-scorer";
import { ATTACK_CORPUS } from "./attack-corpus";
import {
  createAuditEntry,
  hashContent,
  generateSessionId,
  logAuditEntry,
} from "./audit";
import { DEFAULT_CONFIG_YAML } from "./default-config";
import { decodeEncodedMatches } from "./decoder";

/**
 * Resolve filter config with priority: explicit path > env var > embedded default.
 *
 * 1. If configPath is provided, load from that file (throws on error)
 * 2. If PAI_CONTENT_FILTER_CONFIG env var is set, load from that path
 * 3. Fall back to embedded default config (always available, even in compiled binaries)
 */
function resolveConfig(configPath?: string): FilterConfig {
  // Priority 1: explicit path
  if (configPath) {
    return loadConfig(configPath);
  }

  // Priority 2: environment variable
  const envPath = process.env.PAI_CONTENT_FILTER_CONFIG;
  if (envPath) {
    return loadConfig(envPath);
  }

  // Priority 3: embedded default (works in compiled binaries)
  return loadConfigFromString(DEFAULT_CONFIG_YAML);
}

/**
 * Decode encoded strings and match against injection/exfiltration patterns.
 *
 * Returns pattern matches found in decoded content with provenance metadata.
 * Filters patterns to injection and exfiltration categories only.
 * Deduplicates matches to avoid reporting the same pattern in both raw and decoded.
 */
function runDecodeAndMatch(
  encodings: import("./types").EncodingMatch[],
  config: FilterConfig
): DecodedMatch[] {
  if (encodings.length === 0) {
    return [];
  }

  // Decode all encoding matches
  const decodedContent = decodeEncodedMatches(encodings);
  if (decodedContent.length === 0) {
    return [];
  }

  // Filter patterns to injection and exfiltration categories only
  const targetPatterns = config.patterns.filter(
    (p) => p.category === "injection" || p.category === "exfiltration"
  );

  // Run pattern matching against each decoded string
  const allMatches: DecodedMatch[] = [];
  const seenPatternIds = new Set<string>();

  for (const decoded of decodedContent) {
    const patternMatches = matchPatterns(decoded.decoded, targetPatterns);

    // Convert PatternMatch to DecodedMatch with provenance
    for (const match of patternMatches) {
      // Deduplicate: skip if we've already seen this pattern ID
      if (seenPatternIds.has(match.pattern_id)) {
        continue;
      }

      seenPatternIds.add(match.pattern_id);

      allMatches.push({
        ...match,
        encoded_original: decoded.original,
        encoding_type: decoded.type,
        encoded_line: decoded.line,
        encoded_column: decoded.column,
      });
    }
  }

  return allMatches;
}

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
 *
 * Fail-closed: any error in the pipeline returns BLOCKED.
 * Use bypassFilter() to explicitly allow content that was blocked by error.
 */
export function filterContentString(
  content: string,
  filePath: string,
  format: FileFormat,
  configPath?: string,
  auditConfig?: AuditConfig,
  auditOpts?: { sourceRepo?: string; sessionId?: string }
): FilterResult {
  try {
    const config = resolveConfig(configPath);

    // Step 1: Encoding detection
    const encodings = detectEncoding(content, config.encoding_rules);

    // Step 1a: Decode-then-match for injection/exfiltration patterns
    const decodedMatches = runDecodeAndMatch(encodings, config);

    // Short-circuit BLOCK if encodings found (backward compatible behavior)
    // BUT include decoded_matches in result for better diagnostics
    if (encodings.length > 0) {
      const scored = scoreDetections([], encodings);
      const overall = overallScore(scored);
      const result: FilterResult = {
        decision: "BLOCKED",
        matches: [],
        encodings,
        decoded_matches: decodedMatches.length > 0 ? decodedMatches : undefined,
        schema_valid: false,
        file: filePath,
        format,
        scored_detections: scored,
        overall_confidence: overall?.confidence,
        overall_severity: overall?.severity,
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

    // Step 3: L0 — regex pattern matching
    const matches = matchPatterns(content, config.patterns);

    // Step 4: L1 — heuristic prompt-injection scorer.
    // Runs the ported Rebuff heuristic algorithm against the curated attack
    // corpus. Offline, zero-config, pure CPU. Catches paraphrased injection
    // phrasing that the L0 regexes miss.
    const heuristic = scoreHeuristic(content, ATTACK_CORPUS as string[]);

    // Step 5: Scoring — L0 detections feed the existing confidence model;
    // L1 contributes its own score, combined into `overallConfidence` below.
    const scored = scoreDetections(matches, []);
    const overall = overallScore(scored);

    // Step 6: Combined decision logic.
    // A BLOCKED verdict from EITHER layer is BLOCKED. L1 "review" raises the
    // outcome to HUMAN_REVIEW but never blocks (cortex treats HUMAN_REVIEW as
    // allowed — there is no operator in the per-message loop).
    const hasBlockMatch = matches.some((m) => m.severity === "block");
    const l1Block = heuristic.verdict === "block";
    const l1Review = heuristic.verdict === "review";

    // L1's score should be visible in overall_confidence even when L0 found
    // nothing, so cortex's reason/score stays meaningful for L1-only hits.
    const combinedConfidence = Math.max(
      overall?.confidence ?? 0,
      heuristic.verdict === "allow" ? 0 : heuristic.score,
    );
    const overallConfidence =
      combinedConfidence > 0 ? combinedConfidence : undefined;

    if (hasBlockMatch || l1Block) {
      const result: FilterResult = {
        decision: "BLOCKED",
        matches,
        encodings: [],
        schema_valid: schemaValid,
        file: filePath,
        format,
        scored_detections: scored,
        overall_confidence: overallConfidence,
        overall_severity: overall?.severity ?? (l1Block ? "HIGH" : undefined),
        heuristic,
      };
      maybeLogAudit(result, content, auditConfig, auditOpts);
      return result;
    }

    // Free-text always requires human review, even when clean. An L1 "review"
    // verdict also routes structured formats to HUMAN_REVIEW.
    if (format === "markdown" || format === "mixed" || l1Review) {
      const result: FilterResult = {
        decision: "HUMAN_REVIEW",
        matches,
        encodings: [],
        schema_valid: schemaValid,
        file: filePath,
        format,
        scored_detections: scored.length > 0 ? scored : undefined,
        overall_confidence: overallConfidence,
        overall_severity: overall?.severity,
        heuristic,
      };
      maybeLogAudit(result, content, auditConfig, auditOpts);
      return result;
    }

    // Structured format, clean on both layers
    const result: FilterResult = {
      decision: "ALLOWED",
      matches,
      encodings: [],
      schema_valid: schemaValid,
      file: filePath,
      format,
      scored_detections: scored.length > 0 ? scored : undefined,
      overall_confidence: overallConfidence,
      overall_severity: overall?.severity,
      heuristic,
    };
    maybeLogAudit(result, content, auditConfig, auditOpts);
    return result;
  } catch (e) {
    // Fail-closed: any pipeline error returns BLOCKED
    console.error(
      `[content-filter] Pipeline error (fail-closed): ${e instanceof Error ? e.message : String(e)}`
    );
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
