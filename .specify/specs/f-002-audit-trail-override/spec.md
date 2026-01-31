# F-002: Audit Trail & Override

## Overview

Persistent, append-only audit logging for all cross-project content operations, plus a human override mechanism with accountability. Layer 3 of the defense-in-depth architecture.

**Status:** Stub — to be fully specified when implementation reaches this feature.

## Source Requirements

From F-088:
- **R-005: Audit Trail** — Persistent log of all content operations (ALLOWED, BLOCKED, OVERRIDE)
- **R-006: Override Mechanism** — Human can override blocked content with logged reason

## Key Capabilities

### Audit Trail
- Append-only JSONL log at `MEMORY/SECURITY/cross-project/audit-YYYY-MM.jsonl`
- Each entry: timestamp, source repo/file, content hash (SHA-256), filter decision, matched patterns, agent context, approver
- Machine-parseable, locally stored (never in shared repos)
- Log rotation at 10MB, retain 3 files (NF-006)

### Override Mechanism
- Human reviews blocked content with matched patterns displayed
- Override requires explicit reason
- Override permanently logged (who approved, why)
- Overridden content presented with warning prefix
- Overrides do NOT set precedent — same content flagged again next time

### Human Review Flow
- Free-text content always requires approval (even when clean)
- Blocked content shows matched pattern and file location
- All human decisions logged (HUMAN_APPROVED, HUMAN_REJECTED, OVERRIDE)

## Dependencies

- **F-001** (Content Filter Engine) — provides FilterResult that triggers audit entries

## Data Model

```typescript
interface AuditEntry {
  timestamp: string;                   // ISO 8601
  session_id: string;
  event_type: "filter_pass" | "filter_block" | "human_review" | "human_approve" | "human_reject" | "override" | "sandbox_violation";
  source_repo: string;
  source_file: string;
  content_hash: string;                // SHA-256
  decision: "ALLOWED" | "BLOCKED" | "OVERRIDE" | "HUMAN_APPROVED" | "HUMAN_REJECTED";
  matched_patterns: string[];          // pattern IDs
  agent_context: "quarantined" | "privileged";
  approver?: string;                   // principal name for overrides
  reason?: string;                     // override reason
}
```

## File Structure

```
src/lib/
├── audit.ts              # Audit trail logger + rotation
└── human-review.ts       # Human review and override flow
src/commands/
└── content-filter.ts     # Extended: `content-filter audit [--last N]`
```

## F-088 Task Mapping

| F-088 Task | Description |
|------------|-------------|
| T-1.3 | Audit logger |
| T-3.2 | Human review flow |
| T-5.2 | Audit log rotation |

---
*Decomposed from F-088, 2026-01-31*
*Source requirements: R-005, R-006*
