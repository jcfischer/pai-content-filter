# F-004: Verification

## Test Results

```
bun test v1.3.6
 183 pass
 0 fail
 361 expect() calls
Ran 183 tests across 6 files. [4.23s]
```

## Type Check

```
bunx tsc --noEmit
(clean — no errors)
```

## F-004 Specific Tests (24/24 passing)

### CrossProjectProfile (6 tests)
- [x] Profile config file exists and parses
- [x] Profile has correct name ("cross-project")
- [x] Profile allows read-only tools (Read, Glob, Grep, WebFetch)
- [x] Profile denies write/execute tools (Bash, Write, Edit, NotebookEdit)
- [x] Profile denies USER/ path
- [x] Rejects invalid profile

### runQuarantine — success (6 tests)
- [x] Collects valid TypedReferences from stdout
- [x] Returns empty references for empty JSON array
- [x] Returns empty result for no files
- [x] Tracks filesProcessed count
- [x] Records durationMs
- [x] exitCode is 0 on success

### runQuarantine — provenance validation (3 tests)
- [x] Rejects references with invalid provenance
- [x] Handles mixed valid and invalid references
- [x] All-invalid references still returns success with errors

### runQuarantine — error handling (5 tests)
- [x] Handles non-zero exit code
- [x] Handles malformed stdout (not JSON)
- [x] Handles stdout that is JSON but not an array
- [x] Handles timeout
- [x] Handles stderr output on failure

### QuarantineResult metadata (2 tests)
- [x] Success result has all required fields
- [x] Error result has all required fields

### buildDefaultConfig (2 tests)
- [x] Returns config with defaults (30s timeout)
- [x] Allows override of timeoutMs

## TDD Evidence

Tests written FIRST (RED phase confirmed: "Cannot find module '../src/lib/quarantine-runner'"), then implementation (GREEN phase: all 24 pass).
