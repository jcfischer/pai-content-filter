# F-004: Dual-Context Sandboxing — Tasks

## T-4.1: Add quarantine types to types.ts [T]
**depends:** none
**TDD**: Write profile schema validation tests → add types → verify green

## T-4.2: Create MCP profile config [T]
**depends:** T-4.1
**TDD**: Write profile loading test → create JSON file → verify green

## T-4.3: Implement quarantine runner [T]
**depends:** T-4.1
**TDD**: Write runner tests with mock subprocess → implement → verify green
- Mock script outputs valid JSON array of TypedReferences
- Test: spawn, capture stdout, parse, return result

## T-4.4: Add provenance validation gate [T]
**depends:** T-4.3
**TDD**: Write validation tests (valid + invalid refs mixed) → implement → verify green

## T-4.5: Handle error paths [T]
**depends:** T-4.3
**TDD**: Write timeout, exit code, malformed output tests → implement → verify green
- Mock script for each: sleep (timeout), exit 1, print garbage

## T-4.6: Update exports and final verification [T]
**depends:** T-4.1, T-4.2, T-4.3, T-4.4, T-4.5
- Update src/index.ts
- Run full test suite
- Run typecheck
