# F-005: Documentation Updates

## New Files

- `hooks/ContentFilter.hook.ts` — PreToolUse security gate hook
- `src/lib/alerts.ts` — Structured stderr block alerts
- `tests/canary.test.ts` — 61 adversarial canary tests
- `tests/integration/pipeline.test.ts` — 17 end-to-end pipeline tests
- `tests/integration/hook.test.ts` — 14 hook integration tests

## Files Updated

- `src/index.ts` — Added `alertBlock` export

## API Surface

### Hook: `hooks/ContentFilter.hook.ts`
PreToolUse hook for Claude Code. Reads JSON from stdin (`{tool_name, tool_input}`).
- Gates Read/Glob/Grep on paths under `CONTENT_FILTER_SHARED_DIR`
- Exit 0 (allow), Exit 2 (block)
- Fail-open on any error

### `alertBlock(result: FilterResult): void`
Write structured block alert to stderr with pattern IDs, encoding types, and schema status.

## Test Coverage

| Suite | Tests | Coverage |
|-------|-------|----------|
| Canary — Injection | 22 | PI-001 through PI-011 (2 variants each) |
| Canary — Encoding | 7 | EN-001 through EN-006 + multi-encoding |
| Canary — Exfiltration | 10 | EX-001 through EX-005 (2 variants each) |
| Canary — Tool Invocation | 12 | TI-001 through TI-006 (2 variants each) |
| Canary — Benign/FP | 8 | YAML, JSON, MD, mixed + FP rate assertion |
| Canary — Performance | 2 | YAML < 1s, JSON < 1s |
| Pipeline — Integration | 17 | Filter→audit, filter→ref, override, review, quarantine |
| Hook — Integration | 14 | Shared paths, passthrough, fail-open, output format |
| **Total F-005** | **92** | |
