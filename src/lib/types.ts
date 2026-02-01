import { z } from "zod";

// --- Pattern Categories ---

export const PatternCategory = z.enum([
  "injection",
  "exfiltration",
  "tool_invocation",
  "pii",
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

export const FilterDecision = z.enum([
  "ALLOWED",
  "BLOCKED",
  "HUMAN_REVIEW",
  "OVERRIDE",
  "HUMAN_APPROVED",
  "HUMAN_REJECTED",
]);
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

// --- Audit Types (F-002) ---

export const AuditEventType = z.enum([
  "filter_pass",
  "filter_block",
  "human_review",
  "human_approve",
  "human_reject",
  "override",
]);
export type AuditEventType = z.infer<typeof AuditEventType>;

export const AuditDecision = z.enum([
  "ALLOWED",
  "BLOCKED",
  "HUMAN_REVIEW",
  "OVERRIDE",
  "HUMAN_APPROVED",
  "HUMAN_REJECTED",
]);
export type AuditDecision = z.infer<typeof AuditDecision>;

export const AuditEntrySchema = z.object({
  timestamp: z.string(),
  session_id: z.string(),
  event_type: AuditEventType,
  source_repo: z.string(),
  source_file: z.string(),
  content_hash: z.string(),
  decision: AuditDecision,
  matched_patterns: z.array(z.string()),
  encoding_detections: z.array(z.string()),
  schema_valid: z.boolean(),
  format: z.string(),
  approver: z.string().optional(),
  reason: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export interface AuditConfig {
  logDir: string;
  maxSizeBytes: number;
  maxRotatedFiles: number;
}

export const DEFAULT_AUDIT_CONFIG: Omit<AuditConfig, "logDir"> = {
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  maxRotatedFiles: 3,
};

// --- Typed Reference Types (F-003) ---

export const TypedReferenceFilterResult = z.enum([
  "PASSED",
  "OVERRIDE",
  "HUMAN_APPROVED",
]);
export type TypedReferenceFilterResult = z.infer<
  typeof TypedReferenceFilterResult
>;

export const TypedReferenceSchema = z.object({
  id: z.string().uuid(),
  origin: z.string().min(1),
  trust_level: z.literal("untrusted"),
  content_hash: z.string().length(64),
  filter_result: TypedReferenceFilterResult,
  consumed_at: z.string().datetime(),
  format: FileFormat,
  data: z.record(z.unknown()),
  source_file: z.string().min(1),
});
export type TypedReference = z.infer<typeof TypedReferenceSchema>;

export interface ProvenanceResult {
  valid: boolean;
  errors: string[];
}

// --- Quarantine Types (F-004) ---

export const CrossProjectProfileSchema = z.object({
  name: z.string(),
  allowedTools: z.array(z.string()),
  deniedTools: z.array(z.string()),
  deniedPaths: z.array(z.string()),
});
export type CrossProjectProfile = z.infer<typeof CrossProjectProfileSchema>;

export interface QuarantineConfig {
  timeoutMs: number;
  profilePath: string;
  command?: string;
}

export const DEFAULT_QUARANTINE_CONFIG: Omit<QuarantineConfig, "profilePath"> = {
  timeoutMs: 30_000,
};

export interface QuarantineResult {
  success: boolean;
  references: TypedReference[];
  errors: string[];
  durationMs: number;
  filesProcessed: number;
  exitCode: number | null;
}

// --- Sandbox Enforcer Types (F-006) ---

export const CommandType = z.enum([
  "git-clone",
  "gh-clone",
  "curl-download",
  "wget-download",
  "wget-dir",
  "passthrough",
]);
export type CommandType = z.infer<typeof CommandType>;

export interface ParsedCommand {
  type: CommandType;
  url: string | null;
  destination: string | null;
  flags: string[];
  tokens: string[];
  raw: string;
}

export const EnforcerMode = z.enum(["rewrite", "block"]);
export type EnforcerMode = z.infer<typeof EnforcerMode>;

export interface RewriteResult {
  rewritten: string;
  original: string;
  changed: boolean;
  newPath: string | null;
}

export const HookOutputSchema = z.object({
  updatedInput: z
    .object({
      command: z.string(),
    })
    .optional(),
  permissionDecision: z.enum(["allow", "ask", "deny"]).optional(),
});
export type HookOutput = z.infer<typeof HookOutputSchema>;
