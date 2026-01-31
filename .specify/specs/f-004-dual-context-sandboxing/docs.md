# F-004: Documentation Updates

## Files Updated

- `src/index.ts` — Added exports for `runQuarantine`, `loadProfile`, `buildDefaultConfig`, `CrossProjectProfileSchema`
- `src/lib/types.ts` — Added `CrossProjectProfileSchema`, `CrossProjectProfile`, `QuarantineConfig`, `DEFAULT_QUARANTINE_CONFIG`, `QuarantineResult`

## New Files

- `src/lib/quarantine-runner.ts` — Quarantine runner with subprocess isolation
- `config/cross-project-profile.json` — MCP profile for cross-project reads (read-only tools, denied write/execute)
- `tests/quarantine-runner.test.ts` — 24 tests covering profile schema, runner success, provenance validation, error handling, metadata

## API Surface

### `loadProfile(profilePath: string): CrossProjectProfile`
Load and validate a cross-project MCP profile JSON file.

### `buildDefaultConfig(profilePath: string, overrides?): QuarantineConfig`
Build quarantine config with 30s default timeout.

### `runQuarantine(files: string[], config: QuarantineConfig): Promise<QuarantineResult>`
Spawn isolated subprocess, collect TypedReferences from stdout, validate provenance on each.
