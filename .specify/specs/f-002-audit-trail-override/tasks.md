# F-002: Audit Trail & Override — Tasks

## T-2.1: Add audit types to types.ts
**depends:** none
Add AuditEntry, AuditConfig, AuditDecision, AuditEventType Zod schemas and types. Extend FilterDecision to include OVERRIDE, HUMAN_APPROVED, HUMAN_REJECTED.

## T-2.2: Implement audit logger [T]
**depends:** T-2.1
Create `src/lib/audit.ts` with:
- `logAuditEntry(entry, config)` — append JSON line to audit file
- `createAuditEntry(result, opts)` — build AuditEntry from FilterResult
- `hashContent(content)` — SHA-256 hash
- Auto-create audit directory if missing
- Fail-open: catch write errors, warn to stderr

## T-2.3: Implement log rotation [T]
**depends:** T-2.2
Add to `audit.ts`:
- `rotateIfNeeded(config)` — check file size, rotate if > maxSizeBytes
- Rename chain: current → .1, .1 → .2, .2 → .3, delete .4+
- Called at start of `logAuditEntry()` before append

## T-2.4: Implement audit query [T]
**depends:** T-2.2
Add to `audit.ts`:
- `readAuditLog(config, opts)` — read and parse JSONL entries
- Options: `last`, `decision`, `eventType`
- Reverse chronological order
- Skip malformed lines
- Read across rotated files when querying

## T-2.5: Implement human review flow [T]
**depends:** T-2.1, T-2.2
Create `src/lib/human-review.ts` with:
- `overrideDecision(result, approver, reason, auditConfig)` — override blocked content
- `submitReview(result, reviewer, decision, auditConfig)` — record review
- Validate: only BLOCKED content can be overridden
- Both functions log audit entries

## T-2.6: Integrate audit into content filter [T]
**depends:** T-2.2
Modify `src/lib/content-filter.ts`:
- Add optional `auditConfig` parameter to `filterContent()` and `filterContentString()`
- Call `logAuditEntry()` after pipeline completes
- Pass through content hash for audit entry creation
- Audit failure does not affect filter result

## T-2.7: Add CLI audit command [T]
**depends:** T-2.4
Modify `src/cli.ts`:
- Add `audit` subcommand
- Flags: `--last N`, `--json`, `--decision <type>`, `--log-dir <path>`
- Default: show last 20 entries in human-readable format

## T-2.8: Export new modules from index.ts
**depends:** T-2.2, T-2.5
Update `src/index.ts` to export audit and human-review modules.

## T-2.9: Write tests and verify [T]
**depends:** T-2.2, T-2.3, T-2.4, T-2.5, T-2.6, T-2.7
Create test files:
- `tests/audit.test.ts` — logger, rotation, query, content hash
- `tests/human-review.test.ts` — override, review, validation
Run `bun test` and `bun run typecheck` — all must pass.
