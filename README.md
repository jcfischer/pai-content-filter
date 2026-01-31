# pai-content-filter

Inbound content security for [PAI](https://github.com/danielmiessler/PAI) cross-project collaboration ([pai-collab](https://github.com/jcfischer/pai-collab)).

## What This Does

Defense-in-depth security architecture for when PAI agents consume shared repository content. Three layers protect against prompt injection, data exfiltration, and trust model abuse:

1. **Layer 1 — Content Filter** (F-001): Deterministic pattern matching, schema validation, and encoding detection. Catches known attack patterns.
2. **Layer 2 — Architectural Isolation** (F-004): Tool-restricted sandbox. Quarantined agent processes untrusted content with no access to personal tools or data. Primary defense.
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

| Feature | Name | Status | Tests |
|---------|------|--------|-------|
| F-001 | Content Filter Engine | Complete | 90 |
| F-002 | Audit Trail & Override | Complete | 36 |
| F-003 | Typed References & Provenance | Complete | 33 |
| F-004 | Tool-Restricted Sandboxing | Complete | 24 |
| F-005 | Integration & Canary Suite | Complete | 120 |
| | **Total** | **5/5** | **303** |

## Usage

```bash
# Check a file against the content filter
bun run src/cli.ts check path/to/EXTEND.yaml

# Check with JSON output
bun run src/cli.ts check path/to/file.yaml --json

# View audit trail
bun run src/cli.ts audit --last 20

# View filter configuration
bun run src/cli.ts config

# Run all tests
bun test

# Type check
bun run typecheck
```

### Library Usage

```typescript
import { filterContent, filterContentString } from "pai-content-filter";

// Filter a file
const result = filterContent("path/to/EXTEND.yaml");
// result.decision: "ALLOWED" | "BLOCKED" | "HUMAN_REVIEW"

// Filter a string
const result = filterContentString(content, "file.yaml", "yaml");

// Create a typed reference from allowed content
import { createTypedReference } from "pai-content-filter";
const ref = createTypedReference(result, content, { name: "project" });
// ref is frozen — provenance immutable

// Override a blocked result
import { overrideDecision } from "pai-content-filter";
const override = overrideDecision(result, content, "admin", "reviewed manually", auditConfig);
```

### PreToolUse Hook

The hook at `hooks/ContentFilter.hook.ts` integrates with Claude Code's PreToolUse event. Set the `CONTENT_FILTER_SHARED_DIR` environment variable to the shared repository path:

```bash
CONTENT_FILTER_SHARED_DIR=/path/to/shared-repo bun run hooks/ContentFilter.hook.ts
```

The hook gates Read/Glob/Grep tool calls targeting shared repo paths. Exit codes: 0 (allow), 2 (block).

## Pattern Library

36 detection patterns across 4 categories + 6 encoding rules, defined in `config/filter-patterns.yaml`:

| Category | Patterns | Examples |
|----------|----------|---------|
| Injection (PI) | 11 | System prompt override, role-play, jailbreak, delimiter injection |
| Exfiltration (EX) | 5 | Path traversal, network exfil, clipboard, env leak |
| Tool Invocation (TI) | 6 | Shell commands, code execution, MCP tool invoke |
| PII (PII) | 8 | Credit cards, API keys (Anthropic/OpenAI/GitHub/AWS), PEM keys, emails, paths |
| Encoding (EN) | 6 | Base64, unicode escapes, hex, URL-encoded, HTML entities |

All patterns are regex-based, human-editable, and hot-reloadable (no restart required). ReDoS-protected via line truncation and time-bounded regex execution.

## Stack

- TypeScript + Bun
- Zod (schema validation)
- No other external dependencies

## Relationship to CaMeL

This project draws architectural inspiration from [CaMeL (arXiv:2503.18813)](https://arxiv.org/abs/2503.18813) but diverges in significant ways. Understanding these differences is important for assessing the security properties:

| CaMeL Property | This Project | Gap |
|----------------|-------------|-----|
| **Taint propagation** — tracks data provenance through execution | Gate (allow/block at entry) | No flow tracking after gate |
| **Dual-LLM split** — control plane never sees untrusted content | Single LLM with restricted tool set | Sandbox LLM has full access to untrusted content |
| **Unforgeable capability tokens** | SHA-256 content hashes (no MAC/signature) | Forgeable across process boundaries |
| **Reasoning-based classification** | Regex pattern matching (deterministic) | Intentional — constitution requires "no LLM classification" |

The content filter provides practical defense-in-depth (pattern matching + tool restriction + audit trail) but does not achieve CaMeL's formal security guarantees, which require taint propagation.

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

- [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) — DeepMind, 2025. Architectural inspiration; this project implements a subset (see "Relationship to CaMeL" above).
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
