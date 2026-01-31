# F-005: Integration & Canary Suite

## Problem

The content filter engine (F-001), audit trail (F-002), typed references (F-003), and quarantine runner (F-004) are individually tested but not validated as an integrated defense-in-depth stack. We need:

1. A **PreToolUse hook** that wires the filter into Claude Code's tool call pipeline
2. An **adversarial canary suite** proving 100% detection on known payloads
3. **End-to-end pipeline tests** validating the full chain
4. **Performance benchmarks** ensuring sub-second processing

## Users

- PAI developers consuming cross-project content via the Blackboard pattern
- Security reviewers validating the defense-in-depth stack

## Requirements

### R-001: PreToolUse Hook
- Hook fires before Read/Glob/Grep on configurable shared repo paths
- Path matching: glob patterns for shared repo directories
- Decision mapping: ALLOWED → exit(0), BLOCKED → exit(2), HUMAN_REVIEW → exit(0) with warning
- Non-matching paths pass through immediately (exit 0, no filter invocation)
- Fail-open: if filter throws, log error and allow

### R-002: Canary Test Suite
- Adversarial payloads across 4 categories: injection, encoding, exfiltration, tool-invocation
- 100% detection rate on known adversarial payloads
- < 5% false positive rate on benign content
- Benign fixtures include legitimate EXTEND.yaml, REGISTRY.md, SOP markdown
- Payloads test each pattern ID from filter-patterns.yaml

### R-003: End-to-End Pipeline Tests
- Filter → audit chain: blocked content creates audit entry
- Filter → typed reference chain: allowed content creates frozen reference
- Quarantine runner → provenance validation chain
- Override workflow: block → override → audit with OVERRIDE decision
- Human review workflow: HUMAN_REVIEW → approve/reject → audit

### R-004: Performance
- Filter completes in < 1s for structured formats (YAML/JSON)
- No network calls during filter processing
- Hook path check adds < 10ms for non-matching paths

### R-005: Alert System
- Inline stderr alert on BLOCK decisions
- Graceful degradation (no crash if voice unavailable)

## Constraints

- Zero new dependencies (Bun builtins only)
- Deterministic: no LLM classification
- Hook is a standalone script (not imported as module)

## Success Criteria

- All canary payloads detected (100% true positive rate)
- Benign content passes (< 5% false positive rate)
- Full pipeline chains verified end-to-end
- Hook correctly gates shared repo paths
- Performance under 1s for structured formats

## Dependencies

- F-001 (Content Filter Engine)
- F-002 (Audit Trail & Override)
- F-003 (Typed References & Provenance)
- F-004 (Dual-Context Sandboxing)
