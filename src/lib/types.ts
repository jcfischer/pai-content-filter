import { z } from "zod";

// --- Pattern Categories ---

export const PatternCategory = z.enum([
  "injection",
  "exfiltration",
  "tool_invocation",
]);
export type PatternCategory = z.infer<typeof PatternCategory>;

export const PatternSeverity = z.enum(["block", "review"]);
export type PatternSeverity = z.infer<typeof PatternSeverity>;

export const EncodingType = z.enum([
  "base64",
  "unicode",
  "hex",
  "url_encoded",
  "html_entity",
  "multi_file_split",
]);
export type EncodingType = z.infer<typeof EncodingType>;

export const FileFormat = z.enum(["yaml", "json", "markdown", "mixed"]);
export type FileFormat = z.infer<typeof FileFormat>;

export const FilterDecision = z.enum(["ALLOWED", "BLOCKED", "HUMAN_REVIEW"]);
export type FilterDecision = z.infer<typeof FilterDecision>;

// --- Filter Pattern (from YAML config) ---

export const FilterPatternSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: PatternCategory,
  pattern: z.string(),
  severity: PatternSeverity,
  description: z.string(),
});
export type FilterPattern = z.infer<typeof FilterPatternSchema>;

// --- Encoding Rule (from YAML config) ---

export const EncodingRuleSchema = z.object({
  id: z.string(),
  type: EncodingType,
  pattern: z.string(),
  description: z.string(),
  min_length: z.number().optional(),
});
export type EncodingRule = z.infer<typeof EncodingRuleSchema>;

// --- Filter Config (top-level YAML) ---

export const FilterConfigSchema = z.object({
  version: z.string(),
  patterns: z.array(FilterPatternSchema),
  encoding_rules: z.array(EncodingRuleSchema),
});
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

// --- Match Results ---

export interface PatternMatch {
  pattern_id: string;
  pattern_name: string;
  category: string;
  severity: string;
  matched_text: string;
  line: number;
  column: number;
}

export interface EncodingMatch {
  type: string;
  matched_text: string;
  line: number;
  column: number;
}

export interface SchemaResult {
  valid: boolean;
  format: FileFormat;
  errors: string[];
}

// --- Filter Result (output of pipeline) ---

export interface FilterResult {
  decision: FilterDecision;
  matches: PatternMatch[];
  encodings: EncodingMatch[];
  schema_valid: boolean;
  file: string;
  format: FileFormat;
}
