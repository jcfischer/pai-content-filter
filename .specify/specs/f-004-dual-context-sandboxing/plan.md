# F-004: Dual-Context Sandboxing — Technical Plan

## Architecture

New module `src/lib/quarantine-runner.ts` plus a static MCP profile config. The runner spawns a subprocess, captures its stdout as JSON, validates each reference.

### Testability Design

The runner accepts a `command` override in config, allowing tests to substitute a mock script (a simple `bun` script that prints JSON to stdout) instead of the real `k cross-project` command. This avoids requiring `k` to be installed for tests.

### Data Flow

```
runQuarantine(files, config)
  → spawn subprocess (bun script or k cross-project)
  → capture stdout
  → JSON.parse as array
  → validateProvenance() each entry
  → return QuarantineResult { success, references, errors, durationMs }
```

## Key Decisions

1. **Bun.spawn for subprocess** — Bun builtin, no external deps
2. **Command override for testing** — tests use a mock script that prints JSON
3. **Provenance validation on every reference** — defense-in-depth, even quarantine output is untrusted
4. **Partial success** — if 3/5 references valid, return 3 valid + 2 errors
5. **Timeout via AbortController** — Bun supports signal-based kill

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/types.ts` | Modify | Add QuarantineConfig, QuarantineResult, CrossProjectProfile |
| `src/lib/quarantine-runner.ts` | Create | Runner + profile loader |
| `config/cross-project-profile.json` | Create | MCP profile definition |
| `src/index.ts` | Modify | Export new module |
| `tests/quarantine-runner.test.ts` | Create | TDD test suite with mock scripts |
