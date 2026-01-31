# F-005: Tasks

## T-5.1: Canary Test Suite [T]
Write adversarial canary tests covering all pattern IDs:
- Injection canaries: one payload per PI-xxx pattern (PI-001 through PI-011)
- Encoding canaries: one payload per EN-xxx rule (EN-001 through EN-006)
- Exfiltration canaries: one payload per EX-xxx pattern (EX-001 through EX-005)
- Tool invocation canaries: one payload per TI-xxx pattern (TI-001 through TI-006)
- Benign content: legitimate EXTEND.yaml, REGISTRY.md, SOP markdown
- Assert 100% detection, < 5% FP rate

## T-5.2: End-to-End Pipeline Tests [T]
Write integration tests for full pipeline chains:
- Filter → audit logging chain
- Filter → typed reference creation chain
- Override workflow chain (block → override → audit)
- Human review workflow chain
- Quarantine runner → provenance validation chain
depends: T-5.1

## T-5.3: PreToolUse Hook [T]
Write hook tests, then implement `hooks/ContentFilter.hook.ts`:
- Path matching for shared repo patterns
- Decision-to-exit-code mapping
- Non-matching path passthrough
- Fail-open on filter error
depends: T-5.1

## T-5.4: Alert System [T]
Write alert tests, then implement `src/lib/alerts.ts`:
- `alertBlock()` writes structured stderr output
- Includes pattern IDs, file path, decision
depends: T-5.1

## T-5.5: Performance Benchmarks [T]
Write performance tests:
- Structured format (YAML/JSON) completes in < 1s
- No network calls during processing
- Hook path check < 10ms for non-matching
depends: T-5.1, T-5.3

## T-5.6: Final Verification [T]
Run full test suite, type check, update exports.
depends: T-5.1, T-5.2, T-5.3, T-5.4, T-5.5
