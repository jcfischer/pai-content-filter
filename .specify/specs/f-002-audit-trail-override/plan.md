# F-002: Audit Trail & Override — Technical Plan

## Architecture

F-002 adds two modules to `src/lib/` and extends the CLI. No changes to F-001's core filter logic — audit logging is added as a post-pipeline step in `content-filter.ts`.

### Module Design

```
content-filter.ts (existing)
  └── calls audit.logAuditEntry() after pipeline completes
        └── audit.ts (new)
              ├── logAuditEntry()   — append JSONL
              ├── rotateIfNeeded()  — size-based rotation
              └── readAuditLog()   — query entries

human-review.ts (new)
  ├── overrideDecision()  — override blocked content
  └── submitReview()      — record human review decision
  └── both call audit.logAuditEntry()
```

### Data Flow

```
FilterResult (from F-001)
  → logAuditEntry() writes to audit-YYYY-MM.jsonl
  → returns FilterResult unchanged

For overrides:
  FilterResult (BLOCKED) + approver + reason
  → overrideDecision()
  → logAuditEntry(event_type: "override")
  → returns FilterResult with decision: "OVERRIDE"
```

## Key Decisions

1. **JSONL format** — one JSON object per line. Simple, append-friendly, parseable line-by-line. No need for a database.

2. **SHA-256 for content hash** — Bun's `crypto` module. Provides content identity without storing content.

3. **Session ID via `crypto.randomUUID()`** — Bun builtin. Unique per filter invocation, groups related audit events.

4. **Fail-open for logging** — If audit write fails (disk full, permissions), the filter pipeline continues. Logging failure is warned, not thrown.

5. **Monthly file naming** — `audit-YYYY-MM.jsonl` provides natural time-based partitioning. Rotation within a month uses `.1`, `.2`, `.3` suffixes.

6. **No backward integration into F-001 decision logic** — Audit is observation-only. It does not influence filter decisions. Override changes the decision after the fact.

7. **Reverse chronological reads** — `readAuditLog()` reads the file and reverses. For the expected log sizes (< 10MB), this is acceptable.

## Schemas (Zod)

```typescript
// New in types.ts
const AuditEventType = z.enum([
  "filter_pass", "filter_block", "human_review",
  "human_approve", "human_reject", "override"
]);

const AuditDecision = z.enum([
  "ALLOWED", "BLOCKED", "HUMAN_REVIEW",
  "OVERRIDE", "HUMAN_APPROVED", "HUMAN_REJECTED"
]);

const AuditEntrySchema = z.object({
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

const AuditConfigSchema = z.object({
  logDir: z.string(),
  maxSizeBytes: z.number().default(10 * 1024 * 1024),
  maxRotatedFiles: z.number().default(3),
});
```

## Failure Mode Analysis

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Disk full | Audit write fails | Catch, warn, continue (fail-open) |
| Corrupt JSONL line | Query skips entry | Skip unparseable lines in readAuditLog |
| Missing audit dir | First write fails | Auto-create dir on first logAuditEntry |
| Override non-blocked | Logic error | Reject with error — only BLOCKED overridable |
| Rotation during read | Stale data | Acceptable — queries are point-in-time |

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/types.ts` | Modify | Add AuditEntry, AuditConfig, AuditDecision types |
| `src/lib/audit.ts` | Create | Logger, rotation, query |
| `src/lib/human-review.ts` | Create | Override and review flows |
| `src/lib/content-filter.ts` | Modify | Add audit logging after pipeline |
| `src/cli.ts` | Modify | Add `audit` subcommand |
| `src/index.ts` | Modify | Export new modules |
| `tests/audit.test.ts` | Create | Audit logger + rotation tests |
| `tests/human-review.test.ts` | Create | Override + review tests |
