// @metafactory/content-filter: Inbound content security for agent workflows

export { filterContent, filterContentString, detectFormat } from "./lib/content-filter";
export { loadConfig, loadConfigFromString, matchPatterns, luhnCheck, isPlaceholder } from "./lib/pattern-matcher";
export { DEFAULT_CONFIG_YAML } from "./lib/default-config";
export { detectEncoding, looksLikeIdentifier } from "./lib/encoding-detector";
export {
  shannonEntropy,
  looksLikeShaToken,
  looksLikePathSegment,
  isLikelyBase64,
  BASE64_ENTROPY_FLOOR,
} from "./lib/entropy";
export {
  scoreHeuristic,
  diceCoefficient,
  normalizeText,
  L1_BLOCK_THRESHOLD,
  L1_REVIEW_THRESHOLD,
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
