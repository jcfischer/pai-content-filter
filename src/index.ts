// @metafactory/content-filter: Inbound content security for agent workflows

export { filterContent, filterContentString, detectFormat } from "./lib/content-filter";
export { loadConfig, loadConfigFromString, matchPatterns, luhnCheck, isPlaceholder } from "./lib/pattern-matcher";
export { DEFAULT_CONFIG_YAML } from "./lib/default-config";
export { detectEncoding, looksLikeIdentifier } from "./lib/encoding-detector";
// L0 base64 verdict — only the consumer-facing surface is re-exported.
// shannonEntropy / looksLikeShaToken / looksLikePathSegment are internal
// helpers; import them from "./lib/entropy" directly if ever needed in tests.
export { isLikelyBase64, BASE64_ENTROPY_FLOOR } from "./lib/entropy";
// L1 heuristic scorer — only the consumer-facing surface is re-exported.
// diceCoefficient / normalizeText are internal helpers (tests import them from
// "./lib/heuristic-scorer" directly), kept out of the published API surface.
export {
  scoreHeuristic,
  L1_BLOCK_THRESHOLD,
  L1_REVIEW_THRESHOLD,
  L1_MAX_INPUT_CHARS,
} from "./lib/heuristic-scorer";
export { ATTACK_CORPUS } from "./lib/attack-corpus";
export { validateSchema } from "./lib/schema-validator";
export {
  logAuditEntry,
  readAuditLog,
  buildAuditConfig,
  createAuditEntry,
  hashContent,
  generateSessionId,
  currentLogName,
  rotateIfNeeded,
} from "./lib/audit";
export { overrideDecision, submitReview } from "./lib/human-review";
export { bypassFilter } from "./lib/bypass";
export {
  createTypedReference,
  validateProvenance,
  extractOrigin,
} from "./lib/typed-reference";
export {
  runQuarantine,
  loadProfile,
  buildDefaultConfig,
} from "./lib/quarantine-runner";
export { alertBlock } from "./lib/alerts";
export {
  extractFirstCommand,
  tokenize,
  classifyCommand,
} from "./lib/command-parser";
export {
  extractRepoName,
  rewriteCommand,
  buildHookOutput,
} from "./lib/sandbox-rewriter";
export { scoreDetections, overallScore } from "./lib/scoring";
export {
  decodeBase64,
  decodeUnicode,
  decodeHex,
  decodeUrlEncoded,
  decodeHtmlEntity,
  decodeEncodedMatches,
} from "./lib/decoder";
export {
  TypedReferenceSchema,
  TypedReferenceFilterResult,
  CrossProjectProfileSchema,
  CommandType,
  EnforcerMode,
  HookOutputSchema,
  SeverityTier,
} from "./lib/types";
export type {
  FilterConfig,
  FilterPattern,
  FilterResult,
  PatternMatch,
  EncodingMatch,
  DecodedMatch,
  EncodingRule,
  SchemaResult,
  FileFormat,
  FilterDecision,
  AuditEntry,
  AuditConfig,
  AuditEventType,
  AuditDecision,
  TypedReference,
  ProvenanceResult,
  ParsedCommand,
  RewriteResult,
  HookOutput,
  ScoredDetection,
  ContentFilterBypassEvent,
  HeuristicResult,
  HeuristicVerdict,
} from "./lib/types";
export type { DecodedContent } from "./lib/decoder";
