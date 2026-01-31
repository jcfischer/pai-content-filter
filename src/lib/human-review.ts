import type { AuditConfig, AuditDecision, FilterResult } from "./types";
import {
  createAuditEntry,
  hashContent,
  generateSessionId,
  logAuditEntry,
} from "./audit";

/**
 * Override a BLOCKED filter result.
 *
 * Requirements:
 * - Only BLOCKED content can be overridden
 * - Approver and reason are required (non-empty strings)
 * - Creates an audit entry with event_type: "override"
 * - Returns the FilterResult with decision changed to "OVERRIDE"
 * - Overrides do NOT set precedent — same content flagged again next time
 */
export function overrideDecision(
  result: FilterResult,
  content: string,
  approver: string,
  reason: string,
  auditConfig: AuditConfig,
  opts?: { sourceRepo?: string; sessionId?: string }
): FilterResult {
  if (result.decision !== "BLOCKED") {
    throw new Error(
      `Cannot override non-BLOCKED content (decision: ${result.decision})`
    );
  }

  if (!approver || approver.trim() === "") {
    throw new Error("Override requires a non-empty approver");
  }

  if (!reason || reason.trim() === "") {
    throw new Error("Override requires a non-empty reason");
  }

  const contentHash = hashContent(content);
  const sessionId = opts?.sessionId ?? generateSessionId();

  const entry = createAuditEntry(result, {
    contentHash,
    sessionId,
    sourceRepo: opts?.sourceRepo,
    approver: approver.trim(),
    reason: reason.trim(),
    eventTypeOverride: "override",
    decisionOverride: "OVERRIDE",
  });

  logAuditEntry(entry, auditConfig);

  return {
    ...result,
    decision: "OVERRIDE",
  };
}

/**
 * Submit a human review decision for content.
 *
 * Valid decisions: HUMAN_APPROVED, HUMAN_REJECTED
 * Creates an audit entry recording the reviewer and their decision.
 */
export function submitReview(
  result: FilterResult,
  content: string,
  reviewer: string,
  decision: "HUMAN_APPROVED" | "HUMAN_REJECTED",
  auditConfig: AuditConfig,
  opts?: { sourceRepo?: string; sessionId?: string }
): FilterResult {
  if (!reviewer || reviewer.trim() === "") {
    throw new Error("Review requires a non-empty reviewer");
  }

  const validDecisions: AuditDecision[] = ["HUMAN_APPROVED", "HUMAN_REJECTED"];
  if (!validDecisions.includes(decision)) {
    throw new Error(
      `Invalid review decision: ${decision}. Must be HUMAN_APPROVED or HUMAN_REJECTED`
    );
  }

  const contentHash = hashContent(content);
  const sessionId = opts?.sessionId ?? generateSessionId();

  const eventType =
    decision === "HUMAN_APPROVED" ? "human_approve" : "human_reject";

  const entry = createAuditEntry(result, {
    contentHash,
    sessionId,
    sourceRepo: opts?.sourceRepo,
    approver: reviewer.trim(),
    eventTypeOverride: eventType,
    decisionOverride: decision,
  });

  logAuditEntry(entry, auditConfig);

  return {
    ...result,
    decision,
  };
}
