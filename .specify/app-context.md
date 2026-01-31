# App Context: pai-content-filter

## Problem Statement

The pai-collab Blackboard pattern requires PAI agents to consume content from shared repositories contributed by multiple operators. This creates three inbound threat vectors:

1. **Prompt injection via shared content** — Malicious markdown, YAML comments, or PR descriptions could contain instructions that manipulate reviewing agents
2. **Data exfiltration via agent exposure** — If cross-project agents retain access to personal context, crafted payloads could leak data
3. **Trust model abuse** — Community membership is a low bar; identity verification alone doesn't prevent malicious actors

Evidence: Moltbook launch (2026-01-29) demonstrated every threat vector at scale — 151k+ agents, prompt injection, credential leakage, cascading compromise.

Research: CaMeL framework (DeepMind, 2025) proves pattern-matching alone is insufficient — architectural defense is required.

## Users & Stakeholders

- **Primary users**: PAI operators running Kai and other agents
- **Technical level**: Advanced — developers running their own AI infrastructure
- **Constraints**: Must work offline, no LLM-based classification, zero new dependencies beyond Zod

## Current State

- F-086 (Secret Scanning Gate) handles **outbound** security (no secrets in commits)
- No inbound content security exists yet
- pai-collab Blackboard pattern is in Phase 1 design
- kai-launcher (`k`) already supports MCP profile switching

## Constraints & Requirements

- **Deterministic**: Pattern matching only, no LLM classification (code-based filtering)
- **Defense-in-depth**: Three layers (filter → isolation → audit)
- **Zero new dependencies**: Beyond Zod (already in PAI stack)
- **CLI-first, Library-first, Test-first**: PAI constitutional principles
- **< 1 second** filter processing for structured formats
- **Fully offline**: No network calls to classification APIs

## User Experience

- CLI: `content-filter check <file>` for manual verification
- Hook: Automatic PreToolUse gate when reading shared repo content
- Human-in-the-loop: Free-text always requires approval, blocked content shows matched patterns
- Override: Human can approve blocked content with audit-logged reason

## Edge Cases & Error Handling

- Novel injection bypassing Layer 1 → Layer 2 (architectural isolation) prevents damage
- False positives on benign content → Override mechanism with audit trail
- MCP profile can't truly isolate → Separate `k` sessions (different processes)
- Pattern library gaps → Regular canary testing, Moltbook monitoring

## Success Criteria

- 100% detection rate on known adversarial payloads
- < 5% false positive rate on benign content
- Dual-context isolation verified (quarantined agent cannot access personal tools)
- Data flow verified (privileged agent only sees typed references)
- Red team validation passes

## Scope

### In Scope
- Content filter engine (pattern matching, schema validation, encoding detection)
- Audit trail with append-only JSONL logging
- Override mechanism with accountability
- Typed references with provenance metadata
- Dual-context sandboxing via MCP profiles
- Adversarial canary test suite
- CLI and library interfaces

### Explicitly Out of Scope
- Runtime agent behavior monitoring (Phase 3)
- Identity/authentication system (UL platform concern)
- Automated remediation (block and alert only)
- Other operators' security
- Full git history scanning (covered by F-086)

## Origin

Decomposed from F-088 (Inbound Content Security) in kai-improvement-roadmap.
Origin: Jimmy H community feedback + council recommendation (2026-01-31).
