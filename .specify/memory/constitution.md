# Constitution: pai-content-filter

## Core Principles

### CLI-First
Every capability is accessible via CLI before any other interface. The content filter is a CLI tool (`content-filter check <file>`) first, a library second, a hook third.

### Library-First
Core logic lives in `src/lib/` as importable modules. CLI and hooks are thin wrappers. No logic in entry points.

### Test-First
The canary test suite IS the specification. Adversarial payloads define expected behavior. Write tests before implementation.

### Deterministic
No LLM-based classification. All filtering is code-based: regex pattern matching, Zod schema validation, encoding detection. Deterministic inputs produce deterministic outputs.

### Defense-in-Depth
Three layers, each independently valuable:
1. **Content Filter** (Layer 1) — Catches known patterns. Necessary but insufficient.
2. **Architectural Isolation** (Layer 2) — CaMeL-inspired dual-context. Primary defense.
3. **Audit + Override** (Layer 3) — Human accountability. Last line of defense.

Layer 2 must hold even when Layer 1 is completely bypassed.

### Zero New Dependencies
Beyond Zod (already in PAI stack), no new npm packages. Built with Bun builtins.

### Code Before Prompts
Security is enforced by code (regex, schemas, MCP config), not by prompt instructions. Sandboxing is infrastructure-level, not conversational.

## Architectural Constraints

- Pattern library is YAML-based, human-editable, hot-reloadable
- Audit trail is append-only JSONL, locally stored, never in shared repos
- Typed references carry immutable provenance metadata
- Data flows one way: quarantined → typed references → privileged. Never reverse.
- Overrides don't set precedent — same content flagged again next time

## Origin

Decomposed from F-088 (Inbound Content Security) in kai-improvement-roadmap.
Based on CaMeL framework (DeepMind, arXiv:2503.18813) and Moltbook evidence.
Origin: Jimmy H community feedback + council recommendation (2026-01-31).
