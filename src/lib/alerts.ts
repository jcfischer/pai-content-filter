import type { FilterResult } from "./types";

/**
 * Write a structured block alert to stderr.
 *
 * Used by the PreToolUse hook to inform the user when content is blocked.
 * No voice integration — voice is a PAI system-level concern.
 */
export function alertBlock(result: FilterResult): void {
  const patternIds = result.matches.map((m) => m.pattern_id);
  const encodingTypes = result.encodings.map((e) => e.type);

  const lines: string[] = [
    `[ContentFilter] BLOCKED: ${result.file}`,
    `  Decision: ${result.decision}`,
    `  Format: ${result.format}`,
  ];

  if (patternIds.length > 0) {
    lines.push(`  Patterns: ${patternIds.join(", ")}`);
  }
  if (encodingTypes.length > 0) {
    lines.push(`  Encodings: ${encodingTypes.join(", ")}`);
  }
  if (!result.schema_valid) {
    lines.push(`  Schema: INVALID`);
  }

  console.error(lines.join("\n"));
}
