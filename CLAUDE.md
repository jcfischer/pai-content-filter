# pai-content-filter

Inbound content security for PAI cross-project collaboration.

## Stack

- TypeScript + Bun (no npm/yarn/pnpm)
- Zod for schema validation
- Zero other external dependencies

## Development

```bash
bun test              # Run tests
bun run typecheck     # Type checking
specflow status       # Feature queue
specflow run          # Implementation guidance
```

## Architecture

Defense-in-depth with 3 layers, decomposed into 5 features (F-001 through F-005).

- **F-001**: Content Filter Engine (foundation — pattern matching, schema validation, encoding detection)
- **F-002**: Audit Trail & Override (append-only JSONL logging, human override)
- **F-003**: Typed References & Provenance (cross-context data transfer with metadata)
- **F-004**: Dual-Context Sandboxing (CaMeL-inspired quarantined/privileged separation)
- **F-005**: Integration & Canary Suite (hook wiring, adversarial tests, red team)

## Key Principle

**Deterministic filtering only.** No LLM-based classification. All decisions are regex + Zod. Layer 2 (architectural isolation) is the primary defense — Layer 1 (pattern matching) is necessary but insufficient.

## Origin

Decomposed from F-088 in kai-improvement-roadmap. See `.specify/` for all specs.
