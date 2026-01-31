# F-005: Technical Plan

## Architecture

### PreToolUse Hook
`hooks/ContentFilter.hook.ts` — standalone Bun script:
- Reads tool name and input from stdin (JSON)
- Checks if tool is Read/Glob/Grep and path matches shared repo patterns
- If matching: runs `filterContent()` on the target file
- Maps decision to exit code: ALLOWED→0, BLOCKED→2, HUMAN_REVIEW→0 (with stderr warning)
- Non-matching: exit 0 immediately

### Alert System
`src/lib/alerts.ts` — thin alert module:
- `alertBlock(result: FilterResult)` — writes structured block alert to stderr
- No voice integration in library (voice is PAI-level concern, not filter-level)

### Canary Fixtures
`tests/canary/` — adversarial payload files organized by category:
- `injection/` — prompt injection YAML/MD files testing each PI-xxx pattern
- `encoding/` — encoded payload files testing each EN-xxx rule
- `exfiltration/` — exfil attempt files testing each EX-xxx pattern
- `tool-invocation/` — tool invocation files testing each TI-xxx pattern
- `benign/` — clean legitimate content files

### Integration Tests
`tests/integration/` — end-to-end pipeline tests:
- `pipeline.test.ts` — full chain tests using in-memory content
- `canary.test.ts` — runs filter against all canary fixtures
- `hook.test.ts` — hook script integration tests

## Data Flow

```
PreToolUse hook
  → path check (glob match)
  → filterContent() [F-001]
  → maybeLogAudit() [F-002]
  → alertBlock() [F-005]
  → exit code
```

## Decisions

1. **Canary payloads as inline strings** — not separate files. Keeps tests self-contained and avoids fixture management complexity.
2. **Hook as standalone script** — not a module import. Claude Code hooks are scripts.
3. **No voice in library** — voice is a PAI system concern. The hook can optionally call voice server, but the library just writes to stderr.
4. **Performance test uses repeated runs** — median of 5 runs for reliable benchmark.
