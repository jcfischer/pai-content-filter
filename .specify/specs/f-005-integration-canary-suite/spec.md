# F-005: Integration & Canary Suite

## Overview

End-to-end integration: PreToolUse hook wiring, adversarial canary test suite across all file formats, and red team validation. This feature validates the entire defense-in-depth stack works together.

**Status:** Stub — to be fully specified when implementation reaches this feature.

## Source Requirements

From F-088:
- **R-007: Canary Test Suite** — Adversarial test suite for ongoing regression
- **R-001/R-002** (integration aspect) — Hook intercepts Read calls to shared repo paths

## Key Capabilities

### PreToolUse Hook Integration
- `ContentFilter.hook.ts` — fires before Read/Glob/Grep on shared repo paths
- Path detection: trigger only for configurable shared repo path patterns
- Decision mapping: ALLOWED → exit(0), BLOCKED → exit(2), HUMAN_REVIEW → confirm prompt
- Voice + inline alert on BLOCK (graceful degradation if voice unavailable)
- Non-matching paths pass through immediately (no latency impact)

### Canary Test Suite
Adversarial payloads across 4 file formats (REGISTRY.md, EXTEND.yaml, SOPs, PRs):

| Category | Payload Count | Target |
|----------|--------------|--------|
| Injection | 10+ variants | System prompt overrides, role-play, context manipulation, multi-turn, delimiter |
| Encoding | 6+ variants | Base64, unicode, hex, URL-encoded, HTML entities, mixed |
| Exfiltration | 5+ variants | Path traversal, network exfil, copy-paste, email, env leak |
| Tool invocation | 5+ variants | Bash invoke, write invoke, MCP invoke, eval, multi-tool |
| Benign | 20+ files | Legitimate content for false positive testing |

Requirements:
- 100% detection rate on known adversarial payloads
- < 5% false positive rate on benign content
- Runnable as `content-filter test` or `bun test`
- Include real-world patterns observed on Moltbook

### Red Team Validation
- Run PAI RedTeam skill against the content filter with creative evasion
- Test Layer 1 bypass: novel injection patterns
- Test Layer 2 bypass: quarantined session accessing denied tools
- Test combined bypass: payload evading Layer 1 under Layer 2 isolation
- Include Moltbook-sourced injection patterns
- Document findings in red team report
- Any bypass → new canary payload + pattern update

### End-to-End Pipeline Tests
- Hook triggers on shared repo paths, passes through on local paths
- Filter → audit → alert chain for blocked content
- Filter → human review → approve/reject chain for free-text
- Quarantine runner → typed reference → provenance validation chain
- Override workflow: block → override → audit → warning prefix
- Performance: filter completes in < 1s for structured formats
- Offline: no network calls during filter processing

## Dependencies

- **F-001** (Content Filter Engine) — core filter logic
- **F-002** (Audit Trail & Override) — audit logging and override
- **F-003** (Typed References) — provenance validation
- **F-004** (Dual-Context Sandboxing) — quarantine runner

## File Structure

```
hooks/
└── ContentFilter.hook.ts       # PreToolUse security gate
src/lib/
└── alerts.ts                   # Voice + inline alert system
tests/
├── canary/
│   ├── injection/              # Prompt injection payloads
│   ├── encoding/               # Encoded/obfuscated payloads
│   ├── exfiltration/           # Data exfiltration payloads
│   ├── tool-invocation/        # Tool use trigger payloads
│   └── benign/                 # Clean content (false positive testing)
├── integration/
│   ├── hook.test.ts            # Hook integration tests
│   ├── pipeline.test.ts        # End-to-end pipeline tests
│   └── sandbox-profile.test.ts # Sandbox profile tests
└── red-team/
    └── red-team-report.md      # Red team findings
```

## F-088 Task Mapping

| F-088 Task | Description |
|------------|-------------|
| T-3.1 | PreToolUse hook |
| T-3.3 | Voice + inline alerts |
| T-6.1 | Injection canary payloads |
| T-6.2 | Encoding canary payloads |
| T-6.3 | Exfiltration canary payloads |
| T-6.4 | Tool invocation canary payloads |
| T-6.5 | Benign canary payloads |
| T-6.6 | Integration tests |
| T-7.1 | Red team validation |

---
*Decomposed from F-088, 2026-01-31*
*Source requirements: R-007 + integration from R-001, R-002*
