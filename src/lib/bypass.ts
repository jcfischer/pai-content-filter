import type { AuditConfig, ContentFilterBypassEvent, FilterResult } from "./types";
import { hashContent, generateSessionId, logAuditEntry, createAuditEntry } from "./audit";

/**
 * Explicitly bypass the content filter for a specific piece of content.
 *
 * This is the ONLY way to allow content through when the filter returns BLOCKED
 * or when the filter errors (fail-closed). Every bypass is logged as a structured
 * audit event with caller identity, content hash, and a mandatory reason.
 *
 * Requirements:
 * - caller_id must be non-empty (who is requesting the bypass)
 * - reason must be non-empty (why the bypass is needed)
 * - content is hashed for the audit trail
 *
 * Returns the FilterResult with decision changed to ALLOWED and the bypass event.
 */
export function bypassFilter(
  result: FilterResult,
  content: string,
  callerId: string,
  reason: string,
  auditConfig: AuditConfig,
  opts?: { sessionId?: string; sourceRepo?: string }
): { result: FilterResult; bypassEvent: ContentFilterBypassEvent } {
  if (!callerId || callerId.trim() === "") {
    throw new Error("Bypass requires a non-empty caller_id");
  }

  if (!reason || reason.trim() === "") {
    throw new Error("Bypass requires a non-empty reason");
  }

  const contentHash = hashContent(content);
  const sessionId = opts?.sessionId ?? generateSessionId();
  const timestamp = new Date().toISOString();

  const bypassEvent: ContentFilterBypassEvent = {
    event_type: "content_filter_bypass",
    caller_id: callerId.trim(),
    content_hash: contentHash,
    reason: reason.trim(),
    timestamp,
  };

  // Log via the existing audit infrastructure
  const entry = createAuditEntry(result, {
    contentHash,
    sessionId,
    sourceRepo: opts?.sourceRepo,
    approver: callerId.trim(),
    reason: reason.trim(),
    eventTypeOverride: "content_filter_bypass",
    decisionOverride: "ALLOWED",
  });

  logAuditEntry(entry, auditConfig);

  return {
    result: {
      ...result,
      decision: "ALLOWED",
    },
    bypassEvent,
  };
}
