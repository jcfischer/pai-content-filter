# F-002: Audit Trail & Override

## Problem & Pain

When cross-project content passes through the content filter (F-001), there is no record of what was checked, what was blocked, or who overrode a block. Without audit trails:
- Security incidents can't be investigated after the fact
- Human overrides have no accountability chain
- False positive rates can't be measured or tuned
- Compliance requirements (who approved what) go unmet

## Users & Context

- **Primary**: PAI operators reviewing filter decisions after content processing
- **Secondary**: Security auditors investigating incidents
- **Tertiary**: Developers tuning false positive rates using historical data

## Source Requirements

From F-088 (Inbound Content Security):
- **R-005: Audit Trail** — Persistent log of all content operations (ALLOWED, BLOCKED, OVERRIDE)
- **R-006: Override Mechanism** — Human can override blocked content with logged reason

## Requirements

### R-001: Audit Logger

Append-only JSONL logger that records every content filter decision:
- One JSON object per line, parseable independently
- Each entry includes: timestamp (ISO 8601), session ID, event type, source repo/file, content hash (SHA-256), decision, matched patterns, agent context
- File path: configurable, default `audit-YYYY-MM.jsonl`
- File is append-only — entries never modified or deleted
- Logger is synchronous to ensure write completes before pipeline returns

### R-002: Log Rotation

Automatic size-based rotation:
- Trigger: current log exceeds 10MB
- Rotation: rename to `.1.jsonl`, `.2.jsonl`, `.3.jsonl`
- Retention: keep 3 rotated files maximum, delete oldest on overflow
- Rotation happens at start of next write, not during current write
- Rotation must be atomic (no partial writes lost)

### R-003: Override Mechanism

Human override for blocked content:
- Override requires `approver` (string, non-empty) and `reason` (string, non-empty)
- Override creates audit entry with `event_type: "override"` and `decision: "OVERRIDE"`
- Overridden content is marked but NOT whitelisted — same content flagged again next time
- Override returns the original FilterResult with decision changed to `"OVERRIDE"`
- Override function accepts the original FilterResult as input

### R-004: Human Review Flow

Programmatic human review recording:
- Three outcomes: `HUMAN_APPROVED`, `HUMAN_REJECTED`, `OVERRIDE`
- Each outcome creates an audit entry with the reviewer identity
- `submitReview()` function for library consumers
- Review applies to a specific filter result (by content hash + file)

### R-005: Audit Query

Read and query the audit log:
- `readAuditLog()` function returns parsed entries
- Filter by: last N entries, event type, decision, date range
- Entries returned in reverse chronological order (newest first)
- Handles rotated files (reads current + rotated when querying)

### R-006: CLI Extension

New `audit` subcommand for the content-filter CLI:
- `content-filter audit` — show last 20 entries
- `content-filter audit --last N` — show last N entries
- `content-filter audit --json` — machine-readable output
- `content-filter audit --decision BLOCKED` — filter by decision
- `content-filter audit --log-dir <path>` — custom audit log directory

### R-007: Integration with F-001

Content filter pipeline automatically logs audit entries:
- Every call to `filterContent()` or `filterContentString()` produces an audit entry
- Audit logging is opt-in via config (enabled by default when audit dir exists)
- Audit failure does not block the content filter pipeline (fail-open for logging)

## Data Model

```typescript
interface AuditEntry {
  timestamp: string;                   // ISO 8601
  session_id: string;                  // Unique per filter invocation
  event_type: "filter_pass" | "filter_block" | "human_review" | "human_approve" | "human_reject" | "override";
  source_repo: string;
  source_file: string;
  content_hash: string;                // SHA-256 of content
  decision: "ALLOWED" | "BLOCKED" | "HUMAN_REVIEW" | "OVERRIDE" | "HUMAN_APPROVED" | "HUMAN_REJECTED";
  matched_patterns: string[];          // pattern IDs
  encoding_detections: string[];       // encoding types
  schema_valid: boolean;
  format: string;
  approver?: string;                   // For overrides and human reviews
  reason?: string;                     // For overrides
}
```

## File Structure

```
src/lib/
├── audit.ts              # Audit trail logger, rotation, query
├── human-review.ts       # Human review and override flow
└── types.ts              # Extended with AuditEntry, AuditConfig
src/
└── cli.ts                # Extended with `audit` subcommand
tests/
├── audit.test.ts         # Audit logger + rotation tests
└── human-review.test.ts  # Human review + override tests
```

## Edge Cases

- **Concurrent writes**: Single-process (Bun is single-threaded), no locking needed
- **Disk full**: Log write failure should not crash the filter pipeline — catch and warn
- **Empty audit log**: Query returns empty array, no errors
- **Malformed lines in log**: Skip unparseable lines, continue reading
- **Missing audit directory**: Create automatically on first write
- **Override of non-blocked content**: Reject — only BLOCKED content can be overridden

## Success Criteria

1. `logAuditEntry()` appends valid JSONL — each line parses to AuditEntry
2. Rotation triggers at 10MB, retains exactly 3 rotated files
3. `overrideDecision()` requires approver + reason, logs permanently
4. `submitReview()` produces correct HUMAN_APPROVED/HUMAN_REJECTED entries
5. `readAuditLog()` returns entries in reverse chronological order with filtering
6. CLI `audit` command displays entries with `--last`, `--json`, `--decision` flags
7. Integration: `filterContent()` auto-logs when audit dir exists
8. All tests pass, zero type errors

## Constitutional Compliance

- **CLI-First**: New `audit` subcommand ✓
- **Library-First**: Core logic in `src/lib/audit.ts` and `src/lib/human-review.ts` ✓
- **Test-First**: Tests define expected behavior ✓
- **Deterministic**: JSONL append, SHA-256 hash, no LLM ✓
- **Zero New Dependencies**: Uses Bun builtins (fs, crypto) ✓
- **Code Before Prompts**: Override is code-level function, not conversational ✓

## F-088 Task Mapping

| F-088 Task | Description | F-002 Requirement |
|------------|-------------|-------------------|
| T-1.3 | Audit logger | R-001, R-002 |
| T-3.2 | Human review flow | R-003, R-004 |
| T-5.2 | Audit log rotation | R-002 |

---
*Expanded from stub, 2026-01-31*
*Source requirements: R-005, R-006 from F-088*
