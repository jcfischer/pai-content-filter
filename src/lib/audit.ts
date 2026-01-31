import { createHash, randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "fs";
import { join } from "path";
import type {
  AuditConfig,
  AuditEntry,
  AuditEventType,
  FilterResult,
} from "./types";
import { AuditEntrySchema, DEFAULT_AUDIT_CONFIG } from "./types";

/**
 * Get the current audit log filename (monthly partitioning).
 */
export function currentLogName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `audit-${yyyy}-${mm}.jsonl`;
}

/**
 * SHA-256 hash of content string.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  return randomUUID();
}

/**
 * Map FilterResult decision to audit event type.
 */
function decisionToEventType(decision: string): AuditEventType {
  switch (decision) {
    case "ALLOWED":
      return "filter_pass";
    case "BLOCKED":
      return "filter_block";
    case "HUMAN_REVIEW":
      return "human_review";
    case "OVERRIDE":
      return "override";
    case "HUMAN_APPROVED":
      return "human_approve";
    case "HUMAN_REJECTED":
      return "human_reject";
    default:
      return "filter_pass";
  }
}

/**
 * Build an AuditEntry from a FilterResult.
 */
export function createAuditEntry(
  result: FilterResult,
  opts: {
    contentHash: string;
    sessionId: string;
    sourceRepo?: string;
    approver?: string;
    reason?: string;
    eventTypeOverride?: AuditEventType;
    decisionOverride?: string;
  }
): AuditEntry {
  const decision = opts.decisionOverride ?? result.decision;
  return {
    timestamp: new Date().toISOString(),
    session_id: opts.sessionId,
    event_type: opts.eventTypeOverride ?? decisionToEventType(decision),
    source_repo: opts.sourceRepo ?? "",
    source_file: result.file,
    content_hash: opts.contentHash,
    decision: decision as AuditEntry["decision"],
    matched_patterns: result.matches.map((m) => m.pattern_id),
    encoding_detections: result.encodings.map((e) => e.type),
    schema_valid: result.schema_valid,
    format: result.format,
    approver: opts.approver,
    reason: opts.reason,
  };
}

/**
 * Rotate log files if current log exceeds maxSizeBytes.
 *
 * Rotation chain: current → .1, .1 → .2, .2 → .3, delete beyond maxRotatedFiles.
 */
export function rotateIfNeeded(config: AuditConfig): void {
  const logPath = join(config.logDir, currentLogName());
  if (!existsSync(logPath)) return;

  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }

  if (size < config.maxSizeBytes) return;

  const baseName = currentLogName();
  const dotIdx = baseName.lastIndexOf(".jsonl");
  const prefix = baseName.slice(0, dotIdx);
  const ext = ".jsonl";

  // Delete oldest if it would overflow
  const oldestPath = join(
    config.logDir,
    `${prefix}.${config.maxRotatedFiles}${ext}`
  );
  if (existsSync(oldestPath)) {
    unlinkSync(oldestPath);
  }

  // Shift rotated files: .2 → .3, .1 → .2
  for (let i = config.maxRotatedFiles - 1; i >= 1; i--) {
    const src = join(config.logDir, `${prefix}.${i}${ext}`);
    const dst = join(config.logDir, `${prefix}.${i + 1}${ext}`);
    if (existsSync(src)) {
      renameSync(src, dst);
    }
  }

  // Current → .1
  renameSync(logPath, join(config.logDir, `${prefix}.1${ext}`));
}

/**
 * Append an audit entry to the log file.
 * Fail-open: catches write errors and warns to stderr.
 */
export function logAuditEntry(entry: AuditEntry, config: AuditConfig): void {
  try {
    if (!existsSync(config.logDir)) {
      mkdirSync(config.logDir, { recursive: true });
    }

    rotateIfNeeded(config);

    const logPath = join(config.logDir, currentLogName());
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.warn(
      `[content-filter] audit log write failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Build a full AuditConfig with defaults.
 */
export function buildAuditConfig(
  logDir: string,
  overrides?: Partial<AuditConfig>
): AuditConfig {
  return {
    logDir,
    maxSizeBytes: overrides?.maxSizeBytes ?? DEFAULT_AUDIT_CONFIG.maxSizeBytes,
    maxRotatedFiles:
      overrides?.maxRotatedFiles ?? DEFAULT_AUDIT_CONFIG.maxRotatedFiles,
  };
}

/**
 * Read and query audit log entries.
 *
 * Options:
 * - last: return only the last N entries
 * - decision: filter by decision type
 * - eventType: filter by event type
 *
 * Returns entries in reverse chronological order (newest first).
 * Skips malformed lines. Reads rotated files when available.
 */
export function readAuditLog(
  config: AuditConfig,
  opts?: {
    last?: number;
    decision?: string;
    eventType?: string;
  }
): AuditEntry[] {
  if (!existsSync(config.logDir)) return [];

  const baseName = currentLogName();
  const dotIdx = baseName.lastIndexOf(".jsonl");
  const prefix = baseName.slice(0, dotIdx);
  const ext = ".jsonl";

  // Collect all log files: current + rotated (in order: current, .1, .2, .3)
  const files: string[] = [];
  const currentPath = join(config.logDir, baseName);
  if (existsSync(currentPath)) files.push(currentPath);

  for (let i = 1; i <= config.maxRotatedFiles; i++) {
    const rotatedPath = join(config.logDir, `${prefix}.${i}${ext}`);
    if (existsSync(rotatedPath)) files.push(rotatedPath);
  }

  // Parse all entries
  const entries: AuditEntry[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    for (const line of lines) {
      try {
        const parsed = AuditEntrySchema.parse(JSON.parse(line));
        entries.push(parsed);
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Sort reverse chronological
  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply filters
  let filtered = entries;
  if (opts?.decision) {
    filtered = filtered.filter((e) => e.decision === opts.decision);
  }
  if (opts?.eventType) {
    filtered = filtered.filter((e) => e.event_type === opts.eventType);
  }

  // Apply last N limit
  if (opts?.last !== undefined && opts.last > 0) {
    filtered = filtered.slice(0, opts.last);
  }

  return filtered;
}
