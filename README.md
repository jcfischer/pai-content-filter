# pai-content-filter

Inbound content security for [PAI](https://github.com/danielmiessler/PAI) cross-project collaboration ([pai-collab](https://github.com/jcfischer/pai-collab)).

## What This Does

Defense-in-depth security architecture for when PAI agents consume shared repository content. Three layers protect against prompt injection, data exfiltration, and trust model abuse:

1. **Layer 1 — Content Filter** (F-001): Deterministic pattern matching, schema validation, and encoding detection. Catches known attack patterns.
2. **Layer 2 — Architectural Isolation** (F-004): CaMeL-inspired dual-context separation. Quarantined agent processes untrusted content with no access to personal tools or data. Primary defense.
3. **Layer 3 — Audit + Override** (F-002): Human-in-the-loop with persistent accountability trail. Last line of defense.

**Key principle:** Pattern matching is necessary but insufficient. Layer 2 must hold even when Layer 1 is completely bypassed.

## Architecture

```
Shared Repository (pai-collab, Blackboard, PRs)
        │
        ▼
  LAYER 1: Content Filter (F-001)
  • Pattern matching (regex)
  • Schema validation (Zod)
  • Encoding rejection
  • BLOCK / ALLOW / HUMAN_REVIEW
        │
        ▼
  LAYER 2: Quarantined Context (F-004)
  • MCP: Read ONLY
  • No: Bash, Write, email, calendar, Tana
  • Output: TypedReference with provenance (F-003)
        │
        ▼
  PRIVILEGED CONTEXT (Kai)
  • Consumes typed references, not raw content
  • Full MCP access for own operations
        │
        ▼
  LAYER 3: Audit Trail (F-002)
  • Every decision logged (JSONL)
  • Override requires reason
  • Append-only, rotated at 10MB
```

## Features

| Feature | Name | Status | Source |
|---------|------|--------|--------|
| F-001 | Content Filter Engine | Specified | R-001, R-002, R-003 |
| F-002 | Audit Trail & Override | Stub | R-005, R-006 |
| F-003 | Typed References & Provenance | Stub | R-008 |
| F-004 | Dual-Context Sandboxing | Stub | R-004 |
| F-005 | Integration & Canary Suite | Stub | R-007 + e2e |

## Usage (planned)

```bash
# CLI: Check a file
content-filter check path/to/EXTEND.yaml

# CLI: View audit log
content-filter audit --last 20

# CLI: Run canary tests
content-filter test

# Library: Import in TypeScript
import { filterContent } from "pai-content-filter/lib/content-filter";
```

## Stack

- TypeScript + Bun
- Zod (schema validation)
- No other external dependencies

## Related Projects

| Project | Purpose |
|---------|---------|
| [pai-collab](https://github.com/jcfischer/pai-collab) | Cross-project collaboration Blackboard |
| [pai-secret-scanning](https://github.com/jcfischer/pai-secret-scanning) | Outbound security (no secrets in commits) |
| [kai-improvement-roadmap](https://github.com/jcfischer/kai-improvement-roadmap) | Parent roadmap containing F-088 |

Together, `pai-secret-scanning` (outbound) and `pai-content-filter` (inbound) form the complete security gate for Blackboard engagement.

## pai-collab Issues

- [#16](https://github.com/jcfischer/pai-collab/issues/16) — Security architecture
- [#17](https://github.com/jcfischer/pai-collab/issues/17) — Content filter requirements
- [#18](https://github.com/jcfischer/pai-collab/issues/18) — Dual-context sandboxing
- [#24](https://github.com/jcfischer/pai-collab/issues/24) — Canary test suite

## Research References

- [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) — DeepMind, 2025. Architectural defense using Dual LLM pattern.
- [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/) — "99% is a failing grade" for security.
- [Moltbook](https://www.moltbook.com) — Live case study: 151k+ agents, real-world injection failures at scale (2026-01-29).
- [Simon Willison on Moltbook](https://simonwillison.net/2026/Jan/30/moltbook/) — "Normalization of Deviance" in agent systems.
- [NBC News: Moltbook](https://www.nbcnews.com/tech/tech-news/ai-agents-social-media-platform-moltbook-rcna256738) — 1,800 exposed instances leaking credentials.

## Origin

Decomposed from [F-088 (Inbound Content Security)](https://github.com/jcfischer/kai-improvement-roadmap) based on:
- Jimmy H community feedback on Blackboard security (Discord, 2026-01-31)
- Council recommendation adding inbound security as Phase 1 prerequisite
- Moltbook evidence demonstrating threat vectors at scale
- CaMeL research providing the architectural defense model

## License

MIT
